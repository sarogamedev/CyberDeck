const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { requireAuth, requireAdmin } = require('./utils/auth');

// Load config
const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve client app at root
app.use('/', express.static(path.join(__dirname, '..', 'client')));

// Serve admin panel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Auth routes (public - no middleware)
app.use('/api/auth', require('./routes/auth')(config));

// Protected API Routes (require login)
app.use('/api/music', requireAuth, require('./routes/music')(config));
app.use('/api/photos', requireAuth, require('./routes/photos')(config));
app.use('/api/videos', requireAuth, require('./routes/videos')(config));
app.use('/api/llm', requireAuth, require('./routes/llm')(config));
app.use('/api/wiki', requireAuth, require('./routes/wiki')(config));
app.use('/api/maps', requireAuth, require('./routes/maps')(config));
app.use('/api/ebooks', requireAuth, require('./routes/ebooks')(config));
app.use('/api/files', requireAuth, require('./routes/files')(config));

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
        res.status(500).json({ error: err.message });
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

    const commands = {
        ollama: 'ollama serve &',
        kiwix: config.services.kiwix.zimFile
            ? `kiwix-serve --port=${config.services.kiwix.port} "${config.services.kiwix.zimFile}" &`
            : null
    };

    if (!commands[name]) {
        return res.status(400).json({ error: `Unknown service or not configured: ${name}` });
    }

    exec(commands[name], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `${name} started` });
    });
});

app.post('/api/services/:name/stop', requireAdmin, (req, res) => {
    const { name } = req.params;
    const { exec } = require('child_process');

    const commands = {
        ollama: 'pkill -f "ollama serve"',
        kiwix: 'pkill -f "kiwix-serve"'
    };

    if (!commands[name]) {
        return res.status(400).json({ error: `Unknown service: ${name}` });
    }

    exec(commands[name], (err) => {
        // pkill returns error if no process found, that's okay
        res.json({ success: true, message: `${name} stopped` });
    });
});

app.get('/api/services/status', requireAdmin, async (req, res) => {
    const { exec } = require('child_process');
    const checkProcess = (name) => new Promise((resolve) => {
        exec(`pgrep -f "${name}"`, (err) => resolve(!err));
    });

    const [ollamaRunning, kiwixRunning] = await Promise.all([
        checkProcess('ollama serve'),
        checkProcess('kiwix-serve')
    ]);

    res.json({
        ollama: { running: ollamaRunning, enabled: config.services.ollama.enabled },
        kiwix: { running: kiwixRunning, enabled: config.services.kiwix.enabled },
        maps: { running: config.services.maps.enabled, enabled: config.services.maps.enabled }
    });
});

// Terminal command execution (admin only)
app.post('/api/terminal', requireAdmin, (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command provided' });

    const { exec } = require('child_process');
    exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        res.json({
            exitCode: err ? err.code : 0,
            stdout: stdout || '',
            stderr: stderr || ''
        });
    });
});

// Get LAN IP
function getLanIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// SPA fallback - serve client index.html for any unmatched route
app.get('*', (req, res) => {
    // Don't serve index.html for API or admin routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Start server
const PORT = config.port || 8888;
app.listen(PORT, '0.0.0.0', () => {
    const ip = getLanIP();
    console.log('');
    console.log('\x1b[36m  ╔═══════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m  ║      ⚡ CyberDeck Server Running ⚡   ║\x1b[0m');
    console.log('\x1b[36m  ╚═══════════════════════════════════════╝\x1b[0m');
    console.log('');
    console.log(`  \x1b[1mLocal:\x1b[0m    http://localhost:${PORT}`);
    console.log(`  \x1b[1mNetwork:\x1b[0m  http://${ip}:${PORT}`);
    console.log(`  \x1b[1mAdmin:\x1b[0m    http://${ip}:${PORT}/admin`);
    console.log('');
});
