const express = require('express');
const os = require('os');
const { exec } = require('child_process');

module.exports = function (config) {
    const router = express.Router();

    // These kill and start OS processes and drive device hardware, so they are
    // admin actions. They were previously open to any logged-in user.
    const adminOnly = (req, res, next) => {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    };

    // Get battery info (Cross-platform)
    router.get('/battery', (req, res) => {
        const isWin = process.platform === 'win32';
        const isLinux = process.platform === 'linux';

        if (isWin) {
            // Windows Battery via WMIC
            exec('WMIC PATH Win32_Battery GET EstimatedChargeRemaining, BatteryStatus /FORMAT:LIST', (err, stdout) => {
                if (err || !stdout.trim()) {
                    return res.json({ available: false, message: 'No battery detected' });
                }
                const lines = stdout.trim().split('\n');
                const data = {};
                lines.forEach(l => {
                    const [k, v] = l.split('=');
                    if (k && v) data[k.trim()] = v.trim();
                });

                // BatteryStatus 2 = Charging, 1 = Discharging
                const statusMap = { '1': 'DISCHARGING', '2': 'CHARGING', '3': 'FULLY CHARGED', '4': 'LOW', '5': 'CRITICAL' };
                res.json({
                    available: true,
                    percentage: parseInt(data.EstimatedChargeRemaining) || 0,
                    status: statusMap[data.BatteryStatus] || 'UNKNOWN',
                    plugged: data.BatteryStatus === '2' || data.BatteryStatus === '6' || data.BatteryStatus === '7'
                });
            });
        } else {
            // Try Termux first
            exec('termux-battery-status', { timeout: 2000 }, (err, stdout) => {
                if (!err) {
                    try {
                        const data = JSON.parse(stdout);
                        return res.json({
                            available: true,
                            percentage: data.percentage,
                            status: data.status,
                            temperature: data.temperature,
                            health: data.health
                        });
                    } catch (e) { }
                }

                if (isLinux) {
                    // Generic Linux via upower
                    exec('upower -i $(upower -e | grep battery) | grep -E "state|percentage"', (uErr, uStd) => {
                        if (uErr) return res.json({ available: false, message: 'Battery monitoring unavailable' });
                        const lines = uStd.trim().split('\n');
                        const data = {};
                        lines.forEach(l => {
                            const [k, v] = l.split(':');
                            if (k && v) data[k.trim()] = v.trim();
                        });
                        res.json({
                            available: true,
                            percentage: parseInt(data.percentage) || 0,
                            status: (data.state || 'UNKNOWN').toUpperCase()
                        });
                    });
                } else {
                    res.json({ available: false, message: 'Platform not supported for battery' });
                }
            });
        }
    });

    // Get system resources
    router.get('/resources', (req, res) => {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const cpus = os.cpus();

        // Calculate CPU usage from cpus
        let totalIdle = 0, totalTick = 0;
        cpus.forEach(cpu => {
            for (const type in cpu.times) totalTick += cpu.times[type];
            totalIdle += cpu.times.idle;
        });

        res.json({
            cpu: {
                count: cpus.length,
                model: cpus[0]?.model || 'unknown',
                usagePercent: Math.round((1 - totalIdle / totalTick) * 100)
            },
            memory: {
                total: totalMem,
                free: freeMem,
                used: totalMem - freeMem,
                percent: Math.round(((totalMem - freeMem) / totalMem) * 100)
            },
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            platform: os.platform(),
            arch: os.arch()
        });
    });

    // Get storage info (Cross-platform)
    router.get('/storage', (req, res) => {
        const isWin = process.platform === 'win32';
        if (isWin) {
            exec('WMIC logicaldisk where "DeviceID=\'C:\'" get size,freespace /FORMAT:LIST', (err, stdout) => {
                if (err) return res.json({ available: false });
                const lines = stdout.trim().split('\n');
                const data = {};
                lines.forEach(l => {
                    const [k, v] = l.split('=');
                    if (k && v) data[k.trim()] = v.trim();
                });
                const total = parseInt(data.Size) || 0;
                const free = parseInt(data.FreeSpace) || 0;
                const used = total - free;
                const pct = total > 0 ? Math.round((used / total) * 100) : 0;

                const toGB = (b) => (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                res.json({
                    available: true,
                    total: toGB(total),
                    used: toGB(used),
                    free: toGB(free),
                    percent: pct + '%'
                });
            });
        } else {
            exec('df -h /storage/emulated/0 2>/dev/null || df -h / 2>/dev/null', { timeout: 5000 }, (err, stdout) => {
                if (err) return res.json({ available: false });
                const lines = stdout.trim().split('\n');
                if (lines.length < 2) return res.json({ available: false });

                const parts = lines[1].split(/\s+/);
                res.json({
                    available: true,
                    total: parts[1] || '?',
                    used: parts[2] || '?',
                    free: parts[3] || '?',
                    percent: parts[4] || '?'
                });
            });
        }
    });

    // Get running services (Cross-platform)
    router.get('/services', (req, res) => {
        const isWin = process.platform === 'win32';
        const checkProcess = (name) => new Promise((resolve) => {
            const cmd = isWin ? `tasklist /FI "IMAGENAME eq ${name}.exe"` : `pgrep -f "${name}"`;
            exec(cmd, (err, stdout) => {
                if (isWin) resolve(stdout && stdout.includes(name));
                else resolve(!err);
            });
        });

        const ollamaProc = isWin ? 'ollama' : 'ollama serve';
        const kiwixProc = isWin ? 'kiwix-serve' : 'kiwix-serve';

        Promise.all([
            checkProcess(ollamaProc),
            checkProcess(kiwixProc),
            checkProcess('node')
        ]).then(([ollama, kiwix, node]) => {
            res.json({
                ollama: { running: ollama, label: 'Ollama (LLM)', heavy: true },
                kiwix: { running: kiwix, label: 'Kiwix (Wiki)', heavy: false },
                node: { running: node, label: 'CyberDeck Server', heavy: false }
            });
        });
    });

    // Toggle low power mode (Cross-platform)
    router.post('/low-power', adminOnly, (req, res) => {
        const { enabled } = req.body;
        const isWin = process.platform === 'win32';

        if (enabled) {
            const cmd = isWin ? 'taskkill /IM ollama.exe /F /T' : 'pkill -f "ollama serve"';
            exec(cmd + ' 2>/dev/null', () => { });
            res.json({ success: true, mode: 'low-power', message: 'Heavy services stopped.' });
        } else {
            // Restart services
            const cmd = isWin ? 'start /b ollama serve' : 'ollama serve &';
            exec(cmd, () => { });
            res.json({ success: true, mode: 'normal', message: 'Services restarting.' });
        }
    });

    // Torch control (Termux:API)
    router.post('/torch', adminOnly, (req, res) => {
        const { enabled } = req.body;
        exec(`termux-torch ${enabled ? 'on' : 'off'}`, { timeout: 3000 }, (err) => {
            res.json({ success: !err, torch: enabled });
        });
    });

    // Vibrate (Termux:API)
    router.post('/vibrate', adminOnly, (req, res) => {
        exec('termux-vibrate -d 200', { timeout: 3000 }, (err) => {
            res.json({ success: !err });
        });
    });

    // Aggregated stats for dashboard (Cross-platform)
    router.get('/stats', async (req, res) => {
        try {
            // 1. CPU & RAM (Synchronous from 'os' - works on all)
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const cpus = os.cpus();
            let totalIdle = 0, totalTick = 0;
            cpus.forEach(cpu => {
                for (const type in cpu.times) totalTick += cpu.times[type];
                totalIdle += cpu.times.idle;
            });
            const cpuLoad = Math.round((1 - totalIdle / totalTick) * 100);
            const ramPct = Math.round(((totalMem - freeMem) / totalMem) * 100);

            const isWin = process.platform === 'win32';

            // 2. Battery (Terminal command)
            const getBattery = () => new Promise(resolve => {
                if (isWin) {
                    exec('WMIC PATH Win32_Battery GET EstimatedChargeRemaining', (err, stdout) => {
                        if (err) return resolve(100);
                        const match = stdout.match(/\d+/);
                        resolve(match ? parseInt(match[0]) : 100);
                    });
                } else {
                    exec('termux-battery-status', { timeout: 2000 }, (err, stdout) => {
                        if (err) return resolve(100); // Fallback
                        try { resolve(JSON.parse(stdout).percentage || 100); } catch { resolve(100); }
                    });
                }
            });

            // 3. Storage (Terminal command)
            const getStorage = () => new Promise(resolve => {
                if (isWin) {
                    exec('WMIC logicaldisk where "DeviceID=\'C:\'" get size,freespace', (err, stdout) => {
                        if (err) return resolve(0);
                        const nums = stdout.match(/\d+/g);
                        if (!nums || nums.length < 2) return resolve(0);
                        const free = parseInt(nums[0]);
                        const total = parseInt(nums[1]);
                        resolve(Math.round(((total - free) / total) * 100));
                    });
                } else {
                    exec('df -h /storage/emulated/0 2>/dev/null || df -h / 2>/dev/null', { timeout: 2000 }, (err, stdout) => {
                        if (err) return resolve(42);
                        const lines = stdout.trim().split('\n');
                        if (lines.length < 2) return resolve(42);
                        const parts = lines[1].split(/\s+/);
                        const pctStr = parts[4] || '42%';
                        resolve(parseInt(pctStr.replace('%', '')) || 42);
                    });
                }
            });

            const [batteryLevel, storagePct] = await Promise.all([getBattery(), getStorage()]);

            res.json({
                cpu_load: cpuLoad,
                ram_pct: ramPct,
                battery_level: batteryLevel,
                storage_pct: storagePct
            });
        } catch (e) {
            console.error('Stats aggregation error:', e);
            res.status(500).json({ error: 'Failed to aggregate stats' });
        }
    });

    return router;
};
