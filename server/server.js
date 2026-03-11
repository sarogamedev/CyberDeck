const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { requireAuth, requireAdmin } = require('./utils/auth');

// Data home resolution for persistence
const dataHome = process.env.CYBERDECK_DATA_HOME;
if (dataHome && !fs.existsSync(dataHome)) {
    fs.mkdirSync(dataHome, { recursive: true });
}

// Load config
const defaultConfigPath = path.join(__dirname, 'config.json');
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
// In Electron, we want to ensure the path is resolved correctly relative to the app root
const clientPath = path.resolve(__dirname, '..', 'client');



app.use('/', express.static(clientPath));

// Third-Party Licenses Page
app.use('/third-party', require('./routes/licenses'));


// Serve admin panel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Auth routes (public - no middleware)
app.use('/api/auth', require('./routes/auth')(config));

// Load routes
const dtnRoutes = require('./routes/dtn')(config);

// Protected API Routes (require login)
app.use('/api/music', requireAuth, require('./routes/music')(config));
app.use('/api/photos', requireAuth, require('./routes/photos')(config));
app.use('/api/videos', requireAuth, require('./routes/videos')(config));
app.use('/api/llm', requireAuth, require('./routes/llm')(config));
app.use('/api/wiki', requireAuth, require('./routes/wiki')(config));
app.use('/api/maps', requireAuth, require('./routes/maps')(config));
app.use('/api/ebooks', requireAuth, require('./routes/ebooks')(config));
app.use('/api/files', requireAuth, require('./routes/files')(config));
app.use('/api/survival', requireAuth, require('./routes/survival')(config));
app.use('/api/vault', requireAuth, require('./routes/vault')(config));
app.use('/api/power', requireAuth, require('./routes/power')(config));
// Public Store endpoints (no auth) — needed for LAN Content Sync between CyberDeck nodes
const storeRouter = require('./routes/store')(config);
app.get('/api/store/library', (req, res, next) => {
    req.url = '/library';
    storeRouter(req, res, next);
});
app.get('/api/store/serve/:filename', (req, res, next) => {
    req.url = '/serve/' + req.params.filename;
    storeRouter(req, res, next);
});
app.get('/api/store/ollama/manifest/:model', (req, res, next) => {
    req.url = '/peer/ollama/manifest/' + req.params.model;
    storeRouter(req, res, next);
});
app.get('/api/store/ollama/blobs/:digest', (req, res, next) => {
    req.url = '/peer/ollama/blobs/' + req.params.digest;
    storeRouter(req, res, next);
});

// Protected Store (requires login)
app.use('/api/store', requireAuth, storeRouter);

// DTN: P2P sync endpoints (no auth - needed for peer-to-peer epidemic sync)
app.post('/api/dtn/sync/check', (req, res, next) => {
    req.url = '/sync/check';
    dtnRoutes(req, res, next);
});
app.post('/api/dtn/sync/receive', (req, res, next) => {
    req.url = '/sync/receive';
    dtnRoutes(req, res, next);
});
// DTN: User-facing endpoints (require login)
app.use('/api/dtn', requireAuth, dtnRoutes);

// Config API (admin only)
app.get('/api/config', requireAdmin, (req, res) => {
    res.json(config);
});

app.put('/api/config', requireAdmin, (req, res) => {
    try {
        config = { ...config, ...req.body };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        res.json({ success: true, config });
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

// Service management API (admin only)
app.post('/api/services/:name/start', requireAdmin, (req, res) => {
    const { name } = req.params;
    const { exec } = require('child_process');

    if (name === 'ollama') {
        exec('ollama serve &', (err) => {
            if (err) return res.status(500).json({ error: 'Internal server error' });
            res.json({ success: true, message: 'Ollama started' });
        });
    } else if (name === 'kiwix') {
        // Find ZIM file: check config first, then auto-detect in downloads
        let zimFile = config.services.kiwix.zimFile;
        if (!zimFile) {
            const dlDir = path.join(__dirname, 'downloads');
            try {
                if (fs.existsSync(dlDir)) {
                    const zims = fs.readdirSync(dlDir).filter(f => f.endsWith('.zim'));
                    if (zims.length > 0) zimFile = path.join(dlDir, zims[0]);
                }
            } catch (e) { }
        }

        if (!zimFile) {
            return res.status(400).json({
                error: 'No ZIM file found. Either download one from Content Store or set the path in Configuration > Kiwix ZIM File'
            });
        }

        const isWin = process.platform === 'win32';
        const localExePath = path.join(__dirname, 'kiwix-serve.exe');
        let kiwixCmd = 'kiwix-serve';

        // Check if kiwix-serve is available locally or globally
        let cmdCheck = isWin ? `where kiwix-serve` : `which kiwix-serve`;
        if (isWin && fs.existsSync(localExePath)) {
            // Local fallback for Windows
            const port = config.services.kiwix.port || 8889;
            exec(`start /b kiwix-serve.exe --port=${port} "${zimFile}"`, { cwd: __dirname }, (err) => {
                if (err) return res.status(500).json({ error: 'Internal server error' });
                return res.json({ success: true, message: `Kiwix started on port ${port}` });
            });
        } else {
            exec(cmdCheck, (checkErr) => {
                if (checkErr && !isWin) {
                    // Try to install kiwix-tools on Termux directly
                    exec('pkg install -y kiwix-tools 2>&1', { timeout: 120000 }, (installErr) => {
                        if (installErr) {
                            return res.status(400).json({
                                error: 'kiwix-serve not found. Install it: pkg install kiwix-tools or flatpak/choco depending on your OS'
                            });
                        }
                        const port = config.services.kiwix.port || 8889;
                        exec(`kiwix-serve --port=${port} "${zimFile}" &`, (err) => {
                            if (err) return res.status(500).json({ error: 'Internal server error' });
                            res.json({ success: true, message: `Kiwix started on port ${port}` });
                        });
                    });
                } else if (!checkErr) {
                    const port = config.services.kiwix.port || 8889;
                    const startCmd = isWin ? `start /b kiwix-serve.exe --port=${port} "${zimFile}"` : `kiwix-serve --port=${port} "${zimFile}" &`;
                    exec(startCmd, (err) => {
                        if (err) return res.status(500).json({ error: 'Internal server error' });
                        res.json({ success: true, message: `Kiwix started on port ${port}` });
                    });
                } else {
                    res.status(400).json({ error: 'kiwix-serve not found in PATH' });
                }
            });
        }
    } else {
        res.status(400).json({ error: `Unknown service: ${name}` });
    }
});

app.post('/api/services/:name/stop', requireAdmin, (req, res) => {
    const { name } = req.params;
    const { exec } = require('child_process');
    const isWin = process.platform === 'win32';

    const commands = {
        ollama: isWin ? 'taskkill /IM ollama.exe /F /T' : 'pkill -f "ollama serve"',
        kiwix: isWin ? 'taskkill /IM kiwix-serve.exe /F /T' : 'pkill -f "kiwix-serve"'
    };

    if (!commands[name]) {
        return res.status(400).json({ error: `Unknown service: ${name}` });
    }

    exec(commands[name], (err) => {
        // taskkill/pkill return error if no process found, that's okay
        res.json({ success: true, message: `${name} stopped` });
    });
});

app.get('/api/services/status', requireAdmin, async (req, res) => {
    const { exec } = require('child_process');
    const isWin = process.platform === 'win32';

    const checkProcess = (processName) => new Promise((resolve) => {
        const cmd = isWin ? `tasklist | findstr /i "${processName}"` : `pgrep -f "${processName}"`;
        exec(cmd, (err) => resolve(!err)); // No error means process found
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
        if (now - lastSeen < 120000) {
            peers.push({ ip, lastSeen, agoMs: now - lastSeen });
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

// Generate self-signed cert on the fly for local HTTPS
console.log('Generating dynamic self-signed certificate for WebRTC support...');
const attrs = [{ name: 'commonName', value: 'cyberdeck.local' }];
const pemsPromise = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    extensions: [{
        name: 'basicConstraints',
        cA: true
    }, {
        name: 'subjectAltName',
        altNames: [{
            type: 2, // DNS
            value: 'localhost'
        }, {
            type: 7, // IP
            ip: '127.0.0.1'
        }, {
            type: 7, // IP
            ip: getLanIP()
        }]
    }]
});

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
                        console.log(`\x1b[32m[DTN] mDNS DISCOVERY: Found P2P Node at ${aRecord.data}\x1b[0m`);
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
                    console.log(`\x1b[32m[DTN] UDP DISCOVERY: Found P2P Node at ${rinfo.address}\x1b[0m`);
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
app.get('/api/peers', requireAuth, (req, res) => {
    const now = Date.now();
    const peers = [];
    for (const [ip, lastSeen] of dtnPeers.entries()) {
        if (now - lastSeen < 120000) {
            peers.push({ ip, lastSeen, agoMs: now - lastSeen });
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

pemsPromise.then(pems => {
    const httpsServer = https.createServer({
        key: pems.private,
        cert: pems.cert,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false
    }, app);

    // Setup WebSocket chat
    const setupChat = require('./chat');
    setupChat(httpServer);
    setupChat(httpsServer);

    const PORT = config.port || 8888;
    const HTTPS_PORT = config.httpsPort || 8443;

    httpServer.listen(PORT, '0.0.0.0', () => {
        // Do nothing here, log below
    });

    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`\x1b[36m  \x1b[1mCyberDeck HTTPS:\x1b[0m  https://localhost:${HTTPS_PORT}\x1b[0m`);
    });

    // DTN Epidemic Sync Loop
    setInterval(async () => {
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

        // Helper to save a packet to spool
        const savePacket = (packet) => {
            try {
                const filePath = path.join(dtnSpool, `${packet.id}.json`);
                if (!fs.existsSync(filePath)) {
                    fs.writeFileSync(filePath, JSON.stringify(packet, null, 2));
                    return true;
                }
            } catch (e) {
                console.error(`[DTN] Error saving packet ${packet.id}:`, e.message);
            }
            return false;
        };

        for (const peerIp of dtnPeers.keys()) {
            try {
                // Ignore self-signed certs for internal P2P connections
                const https = require('https');
                const agent = new https.Agent({ rejectUnauthorized: false });
                const fetch = require('node-fetch').default || require('node-fetch');

                const checkRes = await fetch(`https://${peerIp}:${HTTPS_PORT}/api/dtn/sync/check`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ known_ids: myKnownIds }),
                    timeout: 5000,
                    agent: agent
                });
                const data = await checkRes.json();

                // Store anything they sent us
                if (data.payloads_for_you && data.payloads_for_you.length > 0) {
                    let r = 0;
                    for (const p of data.payloads_for_you) {
                        if (savePacket(p)) r++;
                    }
                    if (r > 0) console.log(`[DTN] Auto-Sync: Received ${r} missing packets from ${peerIp}`);
                }

                // Send them what they need
                if (data.my_known_ids) {
                    const peerNeeds = myPackets.filter(myP => !data.my_known_ids.includes(myP.id));
                    if (peerNeeds.length > 0) {
                        await fetch(`https://${peerIp}:${HTTPS_PORT}/api/dtn/sync/receive`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ packets: peerNeeds }),
                            timeout: 5000,
                            agent: agent
                        });
                        console.log(`[DTN] Auto-Sync: Sent ${peerNeeds.length} missing packets to ${peerIp}`);
                    }
                }
            } catch (err) {
                // console.error('[DTN] Auto-Sync fetch error:', err.message); // Silenced to prevent spam if peer is offline
            }
        }
    }, 15000);

    console.log('');
    console.log('\x1b[36m  ╔═══════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m  ║\x1b[0m \x1b[34mCyberDeck Server Running\x1b[0m \x1b[36m        ║\x1b[0m');
    console.log('\x1b[36m  ╚═══════════════════════════════════════╝\x1b[0m');
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
