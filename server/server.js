const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { requireAuth, requireAdmin, requireMediaAuth } = require('./utils/auth');
const { requireMeshPeer, signedHeaders } = require('./utils/meshAuth');
const { resolveWithin } = require('./utils/safePath');
const { isPrivateIp, safePort } = require('./utils/netGuard');
const meshLogger = require('./utils/meshLogger');
const rag = require('./utils/rag');

// Data home resolution for persistence
const dataHome = process.env.CYBERDECK_DATA_HOME;
if (dataHome && !fs.existsSync(dataHome)) {
    fs.mkdirSync(dataHome, { recursive: true });
}

// Load config.
//
// config.json is per-machine and no longer tracked in git; config.example.json
// is the template a fresh clone starts from.
const examplePath = path.join(__dirname, 'config.example.json');
const defaultConfigPath = path.join(__dirname, 'config.json');

if (!fs.existsSync(defaultConfigPath)) {
    if (!fs.existsSync(examplePath)) {
        console.error('No config.json or config.example.json found in the server directory.');
        process.exit(1);
    }
    fs.copyFileSync(examplePath, defaultConfigPath);
    console.log('Created server/config.json from config.example.json');
}

const configPath = dataHome ? path.join(dataHome, 'config.json') : defaultConfigPath;

// Migrate/Initialize config if using a custom data home
if (dataHome && !fs.existsSync(configPath)) {
    const defaultConfig = fs.readFileSync(defaultConfigPath, 'utf-8');
    fs.writeFileSync(configPath, defaultConfig);
}

let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// If using persistent storage, ensure all relative paths are resolved relative to the data home
if (dataHome) {
    if (config.paths) {
        for (const key in config.paths) {
            if (!path.isAbsolute(config.paths[key])) {
                config.paths[key] = path.resolve(dataHome, config.paths[key]);
            }
        }
    }
    if (config.services?.maps?.tilesPath && !path.isAbsolute(config.services.maps.tilesPath)) {
        config.services.maps.tilesPath = path.resolve(dataHome, config.services.maps.tilesPath);
    }
    if (config.thumbnails?.cachePath && !path.isAbsolute(config.thumbnails.cachePath)) {
        config.thumbnails.cachePath = path.resolve(dataHome, config.thumbnails.cachePath);
    }
}

const mDnsName = config.mDnsName || 'cyberdeck';

const app = express();

// Middleware
app.use(cors({ origin: false })); // Same-origin only — client is served by the same server

// Security headers. The client still carries a large number of inline event
// handlers, so script-src keeps 'unsafe-inline' for now; tighten it once those
// are converted to delegated listeners.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
            mediaSrc: ["'self'", 'blob:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
            formAction: ["'self'"],
            workerSrc: ["'self'"],
            // helmet defaults script-src-attr to 'none', which blocks every
            // inline on* handler. The client still has many; tighten this to
            // 'none' once they are all delegated listeners.
            scriptSrcAttr: ["'unsafe-inline'"],
            // Off by default: the app deliberately supports a plaintext HTTP
            // mode for captive-portal bootstrap, and upgrading subresource
            // requests there breaks the service worker and every asset.
            upgradeInsecureRequests: null
        }
    },
    // The app is served over a self-signed cert on a LAN; HSTS would pin
    // browsers to HTTPS for the whole IP, including other services on it.
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
}));

// Global rate limit. Only /api/auth/login was throttled before, so every other
// endpoint was free to hammer, including the expensive scan and unlock routes.
app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Peer sync is machine-to-machine and bursty; it has its own auth.
    skip: (req) => req.path.startsWith('/dtn/sync/') || req.path.startsWith('/store/ollama/'),
    message: { error: 'Too many requests, slow down.' }
}));

// Keep the exact bytes of the body so mesh peer signatures cover what we
// actually received, not a re-serialized approximation of it.
app.use(express.json({
    limit: '8mb',
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Captive Portal Interception ("Offline Dead Drop" Mode)
// When devices connect to the Wi-Fi hotspot, they ping these URLs to check for internet access.
// By returning a 302 redirect, the OS automatically prompts the user to "Sign in to network" 
// and opens the CyberDeck dashboard.
app.use((req, res, next) => {
    const captivePaths = [
        '/generate_204',               // Android / Chrome
        '/gen_204',                    // Android
        '/hotspot-detect.html',        // iOS / Apple
        '/ncsi.txt',                   // Windows 8/10
        '/connecttest.txt',            // Windows 11
        '/redirect',                   // Various
        '/success.txt'                 // Various
    ];

    const host = req.get('host') || '';

    // 1. Intercept specific detection endpoints
    if (captivePaths.includes(req.path)) {
        console.log(`[Captive Portal] Intercepted check from ${req.ip} (${host}${req.path})`);
        // Redirect to the root of whatever IP the client used to reach us
        return res.redirect(302, '/');
    }

    // 2. Catch-all: If our server receives a request for an external domain 
    // (e.g. DNS hijacking) but NOT a direct IP access, redirect to CyberDeck.
    // We check if it's an IP address by looking for entirely numbers and dots (or IPv6 colons).
    const isIpAddress = /^[:0-9.]+$/.test(host.split(':')[0]);
    const isLocalhost = host.includes('localhost') || host.includes('.local');

    if (host && !isIpAddress && !isLocalhost) {
        console.log(`[Captive Portal] Redirecting external host request: ${host}`);
        return res.redirect(302, '/');
    }

    next();
});

// Serve client app at root
// Resolved from the server directory so it works regardless of cwd
const clientPath = path.resolve(__dirname, '..', 'client');



app.use('/', express.static(clientPath));

// Third-Party Licenses Page
app.use('/third-party', require('./routes/licenses'));


// Serve admin panel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Auth routes (public - no middleware)
app.use('/api/auth', require('./routes/auth')(config));

// Load routes
rag.init(config);
const dtnRoutes = require('./routes/dtn')(config);
const llmRoutes = require('./routes/llm')(config, rag);

// Protected API Routes (require login)
app.use('/api/music', requireMediaAuth, require('./routes/music')(config));
app.use('/api/photos', requireMediaAuth, require('./routes/photos')(config));
app.use('/api/videos', requireMediaAuth, require('./routes/videos')(config));
app.use('/api/llm', requireAuth, llmRoutes);
app.use('/api/wiki', requireAuth, require('./routes/wiki')(config));
app.use('/api/maps', requireMediaAuth, require('./routes/maps')(config));
app.use('/api/ebooks', requireMediaAuth, require('./routes/ebooks')(config));

app.use('/api/survival', requireAuth, require('./routes/survival')(config));
app.use('/api/vault', requireAuth, require('./routes/vault')(config));
app.use('/api/power', requireAuth, require('./routes/power')(config));
// Peer Store endpoints — used for LAN Content Sync between CyberDeck nodes.
// These were previously unauthenticated, which let any host on the network list
// and read the content library. They now require the shared mesh key.
const storeRouter = require('./routes/store')(config);
app.get('/api/store/library', requireMeshPeer, (req, res, next) => {
    req.url = '/library';
    storeRouter(req, res, next);
});
app.get('/api/store/serve/:filename', requireMeshPeer, (req, res, next) => {
    req.url = '/serve/' + encodeURIComponent(req.params.filename);
    storeRouter(req, res, next);
});
app.get('/api/store/ollama/manifest/:model', requireMeshPeer, (req, res, next) => {
    req.url = '/peer/ollama/manifest/' + encodeURIComponent(req.params.model);
    storeRouter(req, res, next);
});
app.get('/api/store/ollama/blobs/:digest', requireMeshPeer, (req, res, next) => {
    req.url = '/peer/ollama/blobs/' + encodeURIComponent(req.params.digest);
    storeRouter(req, res, next);
});

// Protected Store (requires login)
app.use('/api/store', requireAuth, storeRouter);

// DTN: P2P sync endpoints. Paired peers only — these read out and write into
// the message spool, so an unauthenticated caller could previously drain every
// message and inject forged ones.
app.post('/api/dtn/sync/check', requireMeshPeer, (req, res, next) => {
    req.url = '/sync/check';
    dtnRoutes(req, res, next);
});
app.post('/api/dtn/sync/receive', requireMeshPeer, (req, res, next) => {
    req.url = '/sync/receive';
    dtnRoutes(req, res, next);
});
// DTN: User-facing endpoints (require login)
app.use('/api/dtn', requireAuth, dtnRoutes);

// Config API (admin only)
app.get('/api/config', requireAdmin, (req, res) => {
    res.json(config);
});

// Only these top-level keys may be written through the API. A blind spread of
// req.body previously let an admin repoint every filesystem path and inject
// shell metacharacters into the service launcher.
const WRITABLE_CONFIG_KEYS = new Set([
    'port', 'httpsPort', 'mDnsName', 'paths', 'services', 'thumbnails', 'features'
]);

app.put('/api/config', requireAdmin, (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'Config body must be an object' });
        }

        const incoming = {};
        for (const [key, value] of Object.entries(req.body)) {
            if (!WRITABLE_CONFIG_KEYS.has(key)) {
                return res.status(400).json({ error: `Config key not writable: ${key}` });
            }
            incoming[key] = value;
        }

        if (incoming.port !== undefined && !safePort(incoming.port, null)) {
            return res.status(400).json({ error: 'Invalid port' });
        }
        if (incoming.httpsPort !== undefined && !safePort(incoming.httpsPort, null)) {
            return res.status(400).json({ error: 'Invalid httpsPort' });
        }
        if (incoming.services?.kiwix?.port !== undefined &&
            !safePort(incoming.services.kiwix.port, null)) {
            return res.status(400).json({ error: 'Invalid kiwix port' });
        }

        config = { ...config, ...incoming };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        res.json({
            success: true,
            config,
            note: 'Some settings only take effect after a server restart.'
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// System status API (admin only)
app.get('/api/system', requireAdmin, (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    res.json({
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptime: os.uptime(),
        memory: {
            total: totalMem,
            free: freeMem,
            used: totalMem - freeMem,
            percent: Math.round(((totalMem - freeMem) / totalMem) * 100)
        },
        cpus: os.cpus().length,
        loadavg: os.loadavg()
    });
});

// Real Mesh Activity API
app.get('/api/system/mesh-activity', requireAuth, (req, res) => {
    res.json({ events: meshLogger.getEvents() });
});

// Service management API (admin only)
app.post('/api/services/:name/start', requireAdmin, (req, res) => {
    const { name } = req.params;

    if (name === 'ollama') {
        try {
            const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
            child.on('error', (err) => console.error('[Ollama] Failed to start:', err.message));
            child.unref();
            res.json({ success: true, message: 'Ollama started' });
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    } else if (name === 'kiwix') {
        const dlDir = path.join(__dirname, 'downloads');
        let zimFiles = [];

        // Check downloads directory for all zims
        try {
            if (fs.existsSync(dlDir)) {
                zimFiles = fs.readdirSync(dlDir)
                    .filter(f => f.endsWith('.zim'))
                    .map(f => path.join(dlDir, f));
            }
        } catch (e) { }

        // Also add the configured ZIM if it exists and isn't already included
        if (config.services.kiwix.zimFile && fs.existsSync(config.services.kiwix.zimFile)) {
            if (!zimFiles.includes(config.services.kiwix.zimFile)) {
                zimFiles.push(config.services.kiwix.zimFile);
            }
        }

        if (zimFiles.length === 0) {
            return res.status(400).json({
                error: 'No ZIM files found. Download one from Content Store or set the path in Configuration.'
            });
        }

        const isWin = process.platform === 'win32';
        const localExePath = path.join(__dirname, 'kiwix-serve.exe');

        // Port and ZIM paths both come from a config file the admin API writes,
        // so they are never interpolated into a shell string. spawn() with an
        // argument array removes the injection surface entirely.
        const port = safePort(config.services?.kiwix?.port, 8889);
        const kiwixArgs = [`--port=${port}`, ...zimFiles];

        const launch = (command) => {
            try {
                const child = spawn(command, kiwixArgs, {
                    cwd: __dirname,
                    detached: true,
                    stdio: 'ignore'
                });
                child.on('error', (err) => {
                    console.error('[Kiwix] Failed to start:', err.message);
                });
                child.unref();
                return true;
            } catch (err) {
                console.error('[Kiwix] Failed to spawn:', err.message);
                return false;
            }
        };

        if (isWin && fs.existsSync(localExePath)) {
            if (!launch(localExePath)) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            return res.json({ success: true, message: `Kiwix started on port ${port} with ${zimFiles.length} dataset(s)` });
        }

        execFile(isWin ? 'where' : 'which', ['kiwix-serve'], (checkErr) => {
            if (!checkErr) {
                if (!launch('kiwix-serve')) {
                    return res.status(500).json({ error: 'Internal server error' });
                }
                return res.json({ success: true, message: `Kiwix started correctly on port ${port} with ${zimFiles.length} dataset(s)` });
            }

            if (isWin) {
                return res.status(400).json({ error: 'kiwix-serve not found in PATH' });
            }

            // Try to install kiwix-tools on Termux directly
            execFile('pkg', ['install', '-y', 'kiwix-tools'], { timeout: 120000 }, (installErr) => {
                if (installErr) {
                    return res.status(400).json({
                        error: 'kiwix-serve not found. Install it: pkg install kiwix-tools or flatpak/choco depending on your OS'
                    });
                }
                if (!launch('kiwix-serve')) {
                    return res.status(500).json({ error: 'Internal server error' });
                }
                return res.json({ success: true, message: `Kiwix installed and started with ${zimFiles.length} dataset(s)` });
            });
        });
    } else {
        res.status(400).json({ error: `Unknown service: ${name}` });
    }
});

app.post('/api/services/:name/stop', requireAdmin, (req, res) => {
    const { name } = req.params;
    const isWin = process.platform === 'win32';

    const commands = {
        ollama: isWin ? ['taskkill', ['/IM', 'ollama.exe', '/F', '/T']] : ['pkill', ['-f', 'ollama serve']],
        kiwix: isWin ? ['taskkill', ['/IM', 'kiwix-serve.exe', '/F', '/T']] : ['pkill', ['-f', 'kiwix-serve']]
    };

    if (!commands[name]) {
        return res.status(400).json({ error: `Unknown service: ${name}` });
    }

    const [stopCmd, stopArgs] = commands[name];
    execFile(stopCmd, stopArgs, (err) => {
        // taskkill/pkill return error if no process found, that's okay
        res.json({ success: true, message: `${name} stopped` });
    });
});

app.get('/api/services/status', requireAdmin, async (req, res) => {
    const isWin = process.platform === 'win32';

    // Argument arrays rather than a shell pipeline, so the process names are
    // never re-parsed by a shell.
    const checkProcess = (processName) => new Promise((resolve) => {
        if (isWin) {
            execFile('tasklist', ['/FO', 'CSV', '/NH'], (err, stdout) => {
                if (err) return resolve(false);
                resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
            });
        } else {
            execFile('pgrep', ['-f', processName], (err) => resolve(!err));
        }
    });

    const [ollamaRunning, kiwixRunning] = await Promise.all([
        checkProcess(isWin ? 'ollama.exe' : 'ollama serve'),
        checkProcess(isWin ? 'kiwix-serve.exe' : 'kiwix-serve')
    ]);

    res.json({
        ollama: { running: ollamaRunning, enabled: config.services.ollama.enabled },
        kiwix: { running: kiwixRunning, enabled: config.services.kiwix.enabled },
        maps: { running: config.services.maps.enabled, enabled: config.services.maps.enabled }
    });
});

// Terminal endpoint removed for security — arbitrary command execution is too dangerous

// Get LAN IP
function getLanIP() {
    const interfaces = os.networkInterfaces();
    let bestIp = null;
    let fallbackIp = null;

    for (const name of Object.keys(interfaces)) {
        // Skip obvious virtual/tunnel interfaces
        const lowerName = name.toLowerCase();
        if (lowerName.includes('vbox') || lowerName.includes('vmware') || lowerName.includes('virtual') || lowerName.includes('wsl') || lowerName.includes('docker')) continue;

        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // Prioritize typical private subnets
                const isPrivate = iface.address.startsWith('192.168.') ||
                    iface.address.startsWith('10.') ||
                    iface.address.match(/^172\.(1[6-9]|2[0-9]|3[1-9])\./);

                if (isPrivate) {
                    bestIp = iface.address;
                } else if (!fallbackIp) {
                    fallbackIp = iface.address;
                }
            }
        }
    }
    return bestIp || fallbackIp || '127.0.0.1';
}

const dtnPeers = new Map();

// Endpoints
app.get('/api/peers', requireAuth, (req, res) => {
    const now = Date.now();
    const peers = [];
    for (const [ip, lastSeen] of dtnPeers.entries()) {
        if (now - lastSeen < 30000) {
            peers.push({ ip, lastSeen, agoMs: now - lastSeen });
        } else if (now - lastSeen > 300000) {
            dtnPeers.delete(ip); // Auto-purge entries older than 5 minutes
        }
    }
    let selfIp = getLanIP();
    const hostHeader = req.get('host') || '';
    const hostOnly = hostHeader.split(':')[0];
    const isIp = /^[:0-9.]+$/.test(hostOnly);
    if (isIp && hostOnly !== '127.0.0.1' && hostOnly !== '0.0.0.0') {
        selfIp = hostOnly;
    } else if (selfIp === '127.0.0.1' || selfIp === '::1' || !selfIp) {
        const socketIp = req.socket.localAddress;
        if (socketIp && socketIp !== '::1' && socketIp !== '127.0.0.1') {
            selfIp = socketIp.includes('::ffff:') ? socketIp.split('::ffff:')[1] : socketIp;
        }
    }
    res.json({ peers, self: selfIp });
});

// SPA fallback - serve client index.html for any unmatched route
app.get('*', (req, res) => {
    // Don't serve index.html for API or admin routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Start server with HTTP and dynamic HTTPS (needed for WebRTC/Bluetooth)
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');

const httpServer = http.createServer(app);

// TLS certificate.
//
// This was regenerated on every boot, so the fingerprint changed constantly and
// users could never meaningfully trust it once. We now persist it and reuse it
// until it expires or the LAN IP it covers changes.
const CERT_DIR = process.env.CYBERDECK_DATA_HOME || __dirname;
const CERT_FILE = path.join(CERT_DIR, 'tls-cert.json');

function generateCert(lanIp) {
    const attrs = [{ name: 'commonName', value: `${mDnsName}.local` }];
    return selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        extensions: [{
            name: 'basicConstraints',
            cA: true
        }, {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 2, value: `${mDnsName}.local` },
                { type: 7, ip: '127.0.0.1' },
                { type: 7, ip: lanIp }
            ]
        }]
    });
}

async function loadOrCreateCert() {
    const lanIp = getLanIP();
    try {
        if (fs.existsSync(CERT_FILE)) {
            const stored = JSON.parse(fs.readFileSync(CERT_FILE, 'utf-8'));
            const stillValid = stored.expiresAt && Date.now() < stored.expiresAt - 24 * 60 * 60 * 1000;
            if (stillValid && stored.lanIp === lanIp && stored.pems?.private && stored.pems?.cert) {
                console.log('Reusing stored TLS certificate.');
                return stored.pems;
            }
            console.log('Stored TLS certificate is stale; regenerating.');
        }
    } catch (err) {
        console.error('Could not read stored certificate, regenerating:', err.message);
    }

    console.log('Generating self-signed certificate for WebRTC support...');
    // selfsigned.generate returns a promise; awaiting it is what makes the
    // persisted file contain an actual key pair.
    const pems = await generateCert(lanIp);
    if (!pems || !pems.private || !pems.cert) {
        throw new Error('Certificate generation returned no key material');
    }
    try {
        const tmp = `${CERT_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({
            lanIp,
            createdAt: Date.now(),
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
            pems
        }), { mode: 0o600 });
        fs.renameSync(tmp, CERT_FILE);
    } catch (err) {
        console.error('Could not persist certificate (will regenerate next boot):', err.message);
    }
    return pems;
}

const pemsPromise = loadOrCreateCert();

// Start mDNS Broadcaster
try {
    const mdns = require('multicast-dns')();
    const hostLocal = `${mDnsName}.local`;

    mdns.on('query', function (query) {
        const currentIp = getLanIP();
        if (query.questions[0] && query.questions[0].name === hostLocal) {
            mdns.respond({
                answers: [{ name: hostLocal, type: 'A', class: 'IN', ttl: 300, data: currentIp }]
            });
        }
        if (query.questions[0] && query.questions[0].name === '_cyberdtn._tcp.local') {
            mdns.respond({
                answers: [{ name: '_cyberdtn._tcp.local', type: 'PTR', class: 'IN', ttl: 120, data: `${os.hostname()}._cyberdtn._tcp.local` }],
                additionals: [{ name: `${os.hostname()}._cyberdtn._tcp.local`, type: 'A', class: 'IN', ttl: 120, data: currentIp }]
            });
        }
    });

    mdns.on('response', function (response) {
        if (!response.answers) return;
        const currentIp = getLanIP();
        for (const answer of response.answers) {
            if (answer.name === '_cyberdtn._tcp.local' && answer.type === 'PTR') {
                const aRecord = response.additionals.find(r => r.name === answer.data && r.type === 'A');
                if (aRecord && aRecord.data !== currentIp) {
                    if (!dtnPeers.has(aRecord.data)) {
                        meshLogger.log(`mDNS: Found P2P Node at ${aRecord.data}`);
                    }
                    dtnPeers.set(aRecord.data, Date.now());
                }
            }
        }
    });

    setInterval(() => {
        mdns.query({ questions: [{ name: '_cyberdtn._tcp.local', type: 'PTR' }] });
    }, 10000);

    console.log(`\x1b[35m  \x1b[1mmDNS Service:\x1b[0m   Broadcasting as ${hostLocal}\x1b[0m`);
} catch (e) {
    console.error('\x1b[31m  [!] mDNS Disabled (Missing multicast-dns module)\x1b[0m');
}

// UDP Beacon Logic
try {
    const dgram = require('dgram');
    const udpClient = dgram.createSocket('udp4');
    const nets = os.networkInterfaces();
    const broadcastIps = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                const parts = net.address.split('.');
                parts[3] = '255';
                broadcastIps.push(parts.join('.'));
            }
        }
    }
    udpClient.bind(0, '0.0.0.0', () => {
        udpClient.setBroadcast(true);
        console.log(`\x1b[36m  [DTN] UDP Client bound for broadcast on: ${broadcastIps.join(', ') || '240.0.0.0'}\x1b[0m`);
    });
    const udpServer = dgram.createSocket('udp4');
    udpServer.on('message', (msg, rinfo) => {
        try {
            const payload = JSON.parse(msg.toString());
            const currentIp = getLanIP();
            if (payload.cyberdtn && rinfo.address !== currentIp) {
                if (!dtnPeers.has(rinfo.address)) {
                    meshLogger.log(`UDP: Found P2P Node at ${rinfo.address}`);
                }
                dtnPeers.set(rinfo.address, Date.now());
            }
        } catch (e) { }
    });
    udpServer.bind(8887, '0.0.0.0', () => {
        console.log(`\x1b[36m  [DTN] UDP Discovery listener active on port 8887\x1b[0m`);
    });
    setInterval(() => {
        const msg = Buffer.from(JSON.stringify({ cyberdtn: true }));
        const targets = ['255.255.255.255', ...broadcastIps];
        [...new Set(targets)].forEach(t => udpClient.send(msg, 0, msg.length, 8887, t));
    }, 10000);
} catch (e) { }

// Endpoints

pemsPromise.then(pems => {
    const httpsServer = https.createServer({
        key: pems.private,
        cert: pems.cert,
        minVersion: 'TLSv1.2'
    }, app);

    const PORT = safePort(config.port, 8888);
    const HTTPS_PORT = safePort(config.httpsPort, 8443);

    // The plaintext listener carried logins, session tokens and every API
    // response in the clear. It is now off unless explicitly enabled, and when
    // enabled it only redirects to HTTPS (set features.plainHttpApi to serve
    // the full API over HTTP, for captive-portal or legacy-Android setups).
    const httpEnabled = config.features?.httpRedirect !== false;

    // Opt-in loopback mode for a local wrapper or kiosk browser that cannot
    // accept the self-signed certificate. Binding the plain listener to
    // 127.0.0.1 keeps that working without exposing the API in the clear to
    // the rest of the network.
    const localHttpOnly = process.env.CYBERDECK_LOCAL_HTTP === '1';
    const plainHttpApi = localHttpOnly || config.features?.plainHttpApi === true;
    const httpBindAddress = localHttpOnly && config.features?.plainHttpApi !== true
        ? '127.0.0.1'
        : '0.0.0.0';

    // Setup WebSocket chat. One server instance so HTTP and HTTPS clients share
    // the same client list and history; previously each got its own.
    const setupChat = require('./chat');
    setupChat(httpsServer);
    if (plainHttpApi) setupChat(httpServer);

    if (httpEnabled) {
        if (!plainHttpApi) {
            httpServer.removeAllListeners('request');
            httpServer.on('request', (req, res) => {
                const host = (req.headers.host || '').split(':')[0];
                res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
                res.end();
            });
        }
        httpServer.listen(PORT, httpBindAddress, () => {
            // Do nothing here, log below
        });
    }

    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`\x1b[36m  \x1b[1mCyberDeck HTTPS:\x1b[0m  https://localhost:${HTTPS_PORT}\x1b[0m`);
    });

    // DTN Epidemic Sync Loop
    // A slow or hung peer used to let sync runs overlap and stack up.
    let syncInFlight = false;
    setInterval(async () => {
        if (syncInFlight) return;
        syncInFlight = true;
        try {
        const now = Date.now();
        for (const [peerIp, lastSeen] of dtnPeers.entries()) {
            if (now - lastSeen > 120000) dtnPeers.delete(peerIp);
        }

        if (dtnPeers.size === 0) return;

        const dtnSpool = path.join(__dirname, 'dtn_spool');
        let myKnownIds = [];
        let myPackets = [];
        try {
            if (fs.existsSync(dtnSpool)) {
                const files = fs.readdirSync(dtnSpool);
                for (const f of files) {
                    if (!f.endsWith('.json')) continue;
                    myKnownIds.push(f.replace('.json', ''));
                    myPackets.push(JSON.parse(fs.readFileSync(path.join(dtnSpool, f))));
                }
            }
        } catch (e) { }

        for (const peerIp of dtnPeers.keys()) {
            try {
                // Ignore self-signed certs for internal P2P connections
                const https = require('https');
                const agent = new https.Agent({ rejectUnauthorized: false });
                const fetch = require('node-fetch').default || require('node-fetch');

                const checkPath = '/api/dtn/sync/check';
                const checkBody = JSON.stringify({ known_ids: myKnownIds });
                const checkRes = await fetch(`https://${peerIp}:${HTTPS_PORT}${checkPath}`, {
                    method: 'POST',
                    headers: signedHeaders('POST', checkPath, checkBody, { 'Content-Type': 'application/json' }),
                    body: checkBody,
                    timeout: 5000,
                    agent: agent
                });
                if (!checkRes.ok) continue; // Unpaired or unreachable peer
                const data = await checkRes.json();

                // Store anything they sent us
                if (data.payloads_for_you && data.payloads_for_you.length > 0) {
                    let r = 0;
                    for (const p of data.payloads_for_you) {
                        if (dtnRoutes.savePacket(p)) r++;
                    }
                    if (r > 0) meshLogger.log(`Auto-Sync: Received ${r} packets from ${peerIp}`);
                }

                // Send them what they need
                if (data.my_known_ids) {
                    const peerNeeds = myPackets.filter(myP => !data.my_known_ids.includes(myP.id));
                    if (peerNeeds.length > 0) {
                        const receivePath = '/api/dtn/sync/receive';
                        const receiveBody = JSON.stringify({ packets: peerNeeds });
                        await fetch(`https://${peerIp}:${HTTPS_PORT}${receivePath}`, {
                            method: 'POST',
                            headers: signedHeaders('POST', receivePath, receiveBody, { 'Content-Type': 'application/json' }),
                            body: receiveBody,
                            timeout: 5000,
                            agent: agent
                        });
                        console.log(`[DTN] Auto-Sync: Sent ${peerNeeds.length} missing packets to ${peerIp}`);
                    }
                }
            } catch (err) {
                // Silenced to prevent spam if a peer is offline
            }
        }
        } finally {
            syncInFlight = false;
        }
    }, 15000);

    console.log('');
    console.log('\x1b[36m  CyberDeck Server Running\x1b[0m');
    console.log('');

    const bootIp = getLanIP();
    console.log(`  \x1b[1mOffline URL:\x1b[0m    http://${mDnsName}.local:${PORT}`);
    console.log(`  \x1b[1mLocal (HTTP):\x1b[0m   http://localhost:${PORT}`);
    console.log(`  \x1b[1mNetwork (HTTP):\x1b[0m http://${bootIp}:${PORT} \x1b[90m(Adapts to IP changes dynamically)\x1b[0m`);
    console.log(`  \x1b[1m\x1b[32mWebRTC (HTTPS):\x1b[0m \x1b[32mhttps://${bootIp}:${HTTPS_PORT}\x1b[0m   <-- USE THIS FOR MESH APP`);
    console.log(`  \x1b[1mAdmin:\x1b[0m          http://${bootIp}:${PORT}/admin`);
    console.log(`  \x1b[1mChat WS:\x1b[0m        ws://${bootIp}:${PORT}/ws/chat`);
    console.log('');
    console.log('\x1b[90m  Note: You will see a "Your connection is not private" warning\x1b[0m');
    console.log('\x1b[90m  when accessing HTTPS. Click "Advanced -> Proceed" to continue.\x1b[0m\n');
}).catch(err => {
    console.error('Failed to generate self-signed certificate:', err);
});
