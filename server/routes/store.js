const express = require('express');
const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const http = require('http');
const fetch = require('node-fetch').default || require('node-fetch');

// Strict validation for Ollama model names (e.g. tinyllama:latest, phi3:mini, gemma2:2b)
const SAFE_MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

// SSRF Protection: Validate that an IP is a private/LAN address (RFC 1918)
function isPrivateIp(ip) {
    if (!ip) return false;
    // IPv4 private ranges
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    // Link-local
    if (/^169\.254\./.test(ip)) return false; // Block link-local (cloud metadata)
    // Localhost
    if (ip === '127.0.0.1' || ip === '::1') return false; // Block localhost SSRF
    return false;
}
// Helper: HTTP(S) GET that follows redirects (up to 5)
function httpsGet(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        proto.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
                const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
                return httpsGet(next, maxRedirects - 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// Download a file with progress tracking and pause/resume support
function downloadFile(url, dest, dlId, activeDownloads, activeProcesses, maxRedirects = 5, skipFinalStatus = false, parentDlId = null) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(dest);
        const proto = url.startsWith('https') ? https : http;

        // Check existing file size for resuming
        let startByte = 0;
        if (fs.existsSync(dest)) {
            startByte = fs.statSync(dest).size;
        }

        const options = {
            headers: {},
            rejectUnauthorized: false
        };
        if (startByte > 0) {
            options.headers['Range'] = `bytes=${startByte}-`;
        }

        const req = proto.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
                const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
                return downloadFile(next, dest, dlId, activeDownloads, activeProcesses, maxRedirects - 1, skipFinalStatus, parentDlId).then(resolve).catch(reject);
            }

            if (res.statusCode === 416) {
                res.resume();
                activeProcesses.delete(dlId);
                if (!skipFinalStatus) {
                    activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'complete', progress: 100, output: `Downloaded: ${fileName}` });
                }
                return resolve();
            }

            if (res.statusCode !== 200 && res.statusCode !== 206) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }

            const contentLength = parseInt(res.headers['content-length'], 10) || 0;
            const totalSize = startByte + contentLength;
            let downloaded = startByte;
            const fileStream = fs.createWriteStream(dest, { flags: res.statusCode === 206 ? 'a' : 'w' });

            res.on('data', (chunk) => {
                downloaded += chunk.length;
                const pct = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;
                const dl = activeDownloads.get(dlId) || {};
                if (dl.status === 'paused' || dl.status === 'cancelled') {
                    req.destroy();
                    return;
                }
                activeDownloads.set(dlId, {
                    ...dl, status: 'downloading', progress: pct, progressBytes: downloaded, totalBytes: totalSize,
                    output: `${fileName}\n${(downloaded / 1048576).toFixed(1)} MB / ${(totalSize / 1048576).toFixed(1)} MB (${pct}%)`
                });

                // Update parent if provided (for aggregate speed/progress)
                if (parentDlId) {
                    const pdl = activeDownloads.get(parentDlId);
                    if (pdl) {
                        const subDownloads = pdl.subDownloads || {};
                        subDownloads[dlId] = { downloaded, total: totalSize };

                        let totalDownloaded = 0;
                        let totalToDownload = pdl.totalBytes || 0;
                        Object.values(subDownloads).forEach(sub => {
                            totalDownloaded += sub.downloaded;
                        });

                        activeDownloads.set(parentDlId, {
                            ...pdl,
                            subDownloads,
                            progressBytes: totalDownloaded,
                            progress: totalToDownload > 0 ? Math.round((totalDownloaded / totalToDownload) * 100) : pdl.progress
                        });
                    }
                }
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                activeProcesses.delete(dlId);
                const dl = activeDownloads.get(dlId) || {};
                if (dl.status !== 'cancelled' && dl.status !== 'paused') {
                    const hash = crypto.createHash('sha256');
                    const verifyStream = fs.createReadStream(dest);
                    verifyStream.on('data', (chunk) => hash.update(chunk));
                    verifyStream.on('error', reject);
                    verifyStream.on('end', () => {
                        const fileHash = hash.digest('hex');
                        const expectedHash = dl.expectedSha256;
                        if (expectedHash && fileHash !== expectedHash) {
                            try { fs.unlinkSync(dest); } catch (e) { }
                            activeDownloads.set(dlId, { ...dl, status: 'corrupted', output: 'Integrity failure' });
                            return reject(new Error('Hash mismatch'));
                        }

                        // License sidecar
                        if (dl.licenseMetadata) {
                            try {
                                const sidecarPath = dest.replace(/\.[^.]+$/, '') + '.license.json';
                                fs.writeFileSync(sidecarPath, JSON.stringify({ ...dl.licenseMetadata, sha256: fileHash }, null, 2));
                            } catch (e) { }
                        }

                        if (!skipFinalStatus) {
                            activeDownloads.set(dlId, { ...dl, status: 'complete', progress: 100, output: `Downloaded: ${fileName}` });
                        }
                        resolve();
                    });
                } else {
                    resolve();
                }
            });

            fileStream.on('error', (err) => { try { fs.unlinkSync(dest); } catch (e) { } reject(err); });
        }).on('error', reject);

        activeProcesses.set(dlId, { type: 'request', req, dest, url, maxRedirects });
    });
}

module.exports = function (config) {
    const router = express.Router();
    const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    // Active downloads tracker
    const activeDownloads = new Map();
    // Track processes/requests for cancellation
    const activeProcesses = new Map();

    const fetch = require('node-fetch').default || require('node-fetch');
    const agent = new https.Agent({ rejectUnauthorized: false });

    // Catalog Manifest — loads from store/catalog.json (no code changes needed to add items)
    const CATALOG_PATH = path.join(__dirname, '..', 'store', 'catalog.json');

    router.get('/catalog', (req, res) => {
        try {
            const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
            res.json(catalog);
        } catch (e) {
            console.error('[Store] Failed to load catalog.json:', e.message);
            res.json({ categories: [] });
        }
    });

    // Discover the latest ZIM file URL from a Kiwix directory listing
    async function discoverZimUrl(dirUrl, pattern) {
        const html = await httpsGet(dirUrl);

        // Find all .zim file links matching the pattern
        const regex = new RegExp(`href="(${pattern})"`, 'g');
        const matches = [];
        let m;
        while ((m = regex.exec(html)) !== null) {
            matches.push(m[1]);
        }

        if (matches.length === 0) {
            // Broader search — find all .zim links
            const simpleRegex = /href="([^"]*\.zim)"/g;
            const allZims = [];
            while ((m = simpleRegex.exec(html)) !== null) {
                allZims.push(m[1]);
            }
            if (allZims.length === 0) {
                throw new Error(`No .zim files found at ${dirUrl}`);
            }
            // Filter by the base name (part before the date)
            const baseName = pattern.split('\\d')[0].replace(/\\/g, '');
            const filtered = allZims.filter(z => z.startsWith(baseName));
            if (filtered.length > 0) {
                filtered.sort();
                return dirUrl + filtered[filtered.length - 1];
            }
            throw new Error(`No ZIM matching "${baseName}*" at ${dirUrl}. Available: ${allZims.slice(0, 5).join(', ')}`);
        }

        // Sort and pick the latest (last alphabetically = newest date)
        matches.sort();
        return dirUrl + matches[matches.length - 1];
    }

    // Download endpoint
    router.post('/download', async (req, res) => {
        const { id, url, dirUrl, pattern, cmd, type, sha256, license, licenseUrl, source, sourceUrl, distributor, name: itemName } = req.body;

        // Build sidecar license metadata (travels with content during DTN/LAN sync)
        const licenseMetadata = {
            id, name: itemName || id,
            license: license || 'Unknown',
            licenseUrl: licenseUrl || '',
            source: source || '',
            sourceUrl: sourceUrl || '',
            distributor: distributor || '',
            downloadedAt: new Date().toISOString(),
            notice: 'This content is provided by a third-party project. CyberDeck does not own or claim ownership of this resource. Please comply with the original license terms.'
        };

        if (type === 'ollama') {
            const dlId = id;
            // Extract and validate model name
            const modelName = (cmd || '').replace(/^ollama\s+pull\s+/, '').trim();
            if (!SAFE_MODEL_NAME.test(modelName)) {
                return res.status(400).json({ error: 'Invalid model name' });
            }
            activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: '', type: 'ollama', modelName });

            const proc = execFile('ollama', ['pull', modelName], { timeout: 3600000 });
            activeProcesses.set(dlId, { type: 'process', proc });
            let output = '';
            proc.stdout?.on('data', (d) => {
                output += d;
                const dl = activeDownloads.get(dlId) || {};
                activeDownloads.set(dlId, { ...dl, status: 'downloading', progress: parseProgress(output), output });
            });
            proc.stderr?.on('data', (d) => {
                output += d;
                const dl = activeDownloads.get(dlId) || {};
                activeDownloads.set(dlId, { ...dl, status: 'downloading', progress: parseProgress(output), output });
            });
            proc.on('close', (code) => {
                activeProcesses.delete(dlId);
                const dl = activeDownloads.get(dlId) || {};
                if (dl.status !== 'cancelled') {
                    activeDownloads.set(dlId, { ...dl, status: code === 0 ? 'complete' : 'failed', progress: code === 0 ? 100 : dl.progress, output });
                    // Write sidecar license file for Ollama models
                    if (code === 0) {
                        try {
                            const sidecarPath = path.join(DOWNLOADS_DIR, `${dlId}.license.json`);
                            fs.writeFileSync(sidecarPath, JSON.stringify(licenseMetadata, null, 2));
                            console.log(`[Store] License sidecar written: ${sidecarPath}`);
                        } catch (e) { console.error('[Store] Failed to write license sidecar:', e.message); }
                    }
                }
            });

            res.json({ success: true, downloadId: dlId, message: 'Model download started' });

        } else if (type === 'zim') {
            const dlId = id;
            activeDownloads.set(dlId, { status: 'discovering', progress: 0, output: 'Finding latest version...' });

            try {
                // Step 1: Discover actual download URL
                let downloadUrl;
                if (dirUrl && pattern) {
                    // Auto-discover from directory listing
                    activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: 'Discovering latest file from Kiwix...' });
                    downloadUrl = await discoverZimUrl(dirUrl, pattern);
                } else if (url) {
                    downloadUrl = url;
                } else {
                    activeDownloads.set(dlId, { status: 'failed', progress: 0, output: 'No URL or directory configured' });
                    return res.status(400).json({ error: 'No download URL' });
                }

                const fileName = downloadUrl.split('/').pop();
                const dest = path.join(DOWNLOADS_DIR, fileName);
                activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: `Downloading: ${fileName}`, type: 'zim', dest, expectedSha256: sha256 || null, licenseMetadata });

                // Step 2: Download using Node.js built-in https (no curl/wget needed)
                downloadFile(downloadUrl, dest, dlId, activeDownloads, activeProcesses);

                res.json({ success: true, downloadId: dlId, message: `Downloading: ${fileName}` });

            } catch (err) {
                activeDownloads.set(dlId, { status: 'failed', progress: 0, output: err.message });
                res.json({ success: true, downloadId: dlId, message: err.message });
            }

        } else if (type === 'manual') {
            if (url) res.json({ success: true, downloadId: id, message: 'Open in browser', url });
            else res.status(400).json({ error: 'No URL' });
        } else {
            res.status(400).json({ error: 'Invalid download type' });
        }
    });

    // Pause an active download
    // Progress polling endpoint
    router.get('/progress/:id', (req, res) => {
        const dlId = req.params.id;
        const info = activeDownloads.get(dlId) || { status: 'idle', progress: 0 };
        res.json(info);
    });

    // Pause an active download
    router.post('/progress/:id/pause', (req, res) => {
        const dlId = req.params.id;
        const proc = activeProcesses.get(dlId);
        const dl = activeDownloads.get(dlId);

        if (proc && proc.type === 'request' && proc.req) {
            proc.req.destroy();
            activeProcesses.set(dlId, { ...proc, req: null });
        }
        if (dl) activeDownloads.set(dlId, { ...dl, status: 'paused' });
        res.json({ success: true, status: 'paused' });
    });

    // Resume a paused download
    router.post('/progress/:id/resume', (req, res) => {
        const dlId = req.params.id;
        // Resuming is handled by the frontend re-triggering the pull (for P2P) 
        // or the local store logic (for Internet ZIMs)
        res.json({ success: true, status: 'resuming' });
    });

    // Cancel an active download
    router.post('/progress/:id/cancel', (req, res) => {
        const dlId = req.params.id;
        const proc = activeProcesses.get(dlId);
        const dl = activeDownloads.get(dlId);

        if (proc) {
            if (proc.type === 'process' && proc.proc) proc.proc.kill();
            else if (proc.type === 'request' && proc.req) proc.req.destroy();
            activeProcesses.delete(dlId);
        }
        if (dl) activeDownloads.set(dlId, { ...dl, status: 'cancelled' });
        res.json({ success: true, status: 'cancelled' });
    });

    // Delete a downloaded item
    router.delete('/delete/:id', (req, res) => {
        const dlId = req.params.id;
        const dl = activeDownloads.get(dlId);

        if (dl && dl.type === 'zim' && dl.dest) {
            try {
                if (fs.existsSync(dl.dest)) fs.unlinkSync(dl.dest);
                activeDownloads.delete(dlId);
                return res.json({ success: true, message: 'ZIM file deleted' });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        } else if (dl && dl.type === 'ollama' && dl.modelName) {
            // Validate model name before passing to exec
            if (!SAFE_MODEL_NAME.test(dl.modelName)) {
                activeDownloads.delete(dlId);
                return res.status(400).json({ error: 'Invalid model name' });
            }
            execFile('ollama', ['rm', dl.modelName], { timeout: 30000 }, (err) => {
                activeDownloads.delete(dlId);
                if (err) return res.json({ success: true, message: 'Removed from store (ollama rm may have failed)' });
                res.json({ success: true, message: `Model ${dl.modelName} deleted` });
            });
        } else {
            // Try to find and delete any matching ZIM file
            const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.includes(dlId));
            files.forEach(f => { try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)); } catch (e) { } });
            activeDownloads.delete(dlId);
            res.json({ success: true, message: 'Deleted' });
        }
    });

    // Check what's already downloaded (survives server restart)
    router.get('/status', (req, res) => {
        const results = {};

        // Check ZIM files in downloads dir
        const zimPatterns = {
            'wiki-en-simple': 'wikipedia_en_simple',
            'wiki-en-nopic': 'wikipedia_en_all_nopic',
            'wikibooks': 'wikibooks_en',
            'wikihow': 'wikihow_en',
            'stackexchange': 'stackoverflow',
            'medref': 'mdwiki_en'
        };

        try {
            const files = fs.readdirSync(DOWNLOADS_DIR);
            for (const [itemId, prefix] of Object.entries(zimPatterns)) {
                const match = files.find(f => f.startsWith(prefix) && f.endsWith('.zim'));
                if (match) {
                    const filePath = path.join(DOWNLOADS_DIR, match);
                    try {
                        const stat = fs.statSync(filePath);
                        results[itemId] = {
                            status: 'complete',
                            fileName: match,
                            size: stat.size,
                            dest: filePath,
                            type: 'zim'
                        };
                        // Restore to activeDownloads so delete works
                        if (!activeDownloads.has(itemId)) {
                            activeDownloads.set(itemId, {
                                status: 'complete', progress: 100, type: 'zim', dest: filePath,
                                output: `Downloaded: ${match}`
                            });
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { }

        // Check installed ollama models (non-blocking, with fallback)
        const ollamaModels = {
            'llm-tinyllama': 'tinyllama',
            'llm-phi3-mini': 'phi3:mini',
            'llm-gemma2': 'gemma2:2b',
            'llm-llama3': 'llama3.2:3b',
            'llm-mistral': 'mistral',
            'llm-meditron': 'meditron'
        };

        try {
            exec('ollama list', { timeout: 3000 }, (err, stdout) => {
                if (!err && stdout) {
                    for (const [itemId, modelName] of Object.entries(ollamaModels)) {
                        if (stdout.includes(modelName.split(':')[0])) {
                            results[itemId] = {
                                status: 'complete',
                                modelName,
                                type: 'ollama'
                            };
                            if (!activeDownloads.has(itemId)) {
                                activeDownloads.set(itemId, {
                                    status: 'complete', progress: 100, type: 'ollama', modelName,
                                    output: `Model ${modelName} installed`
                                });
                            }
                        }
                    }
                }
                res.json(results);
            });
        } catch (e) {
            // If exec itself fails, still return ZIM results
            res.json(results);
        }
    });

    // Check download progress
    router.get('/progress/:id', (req, res) => {
        const dl = activeDownloads.get(req.params.id);
        if (!dl) return res.json({ status: 'not_found' });
        res.json(dl);
    });

    function getDirSize(dirPath) {
        let size = 0;
        try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const fullPath = path.join(dirPath, file);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    size += getDirSize(fullPath);
                } else {
                    size += stats.size;
                }
            }
        } catch (e) { }
        return size;
    }

    // List downloaded content (ZIMs, Maps, LLMs)
    router.get('/downloaded', (req, res) => {
        const items = [];

        // 1. ZIM Files
        try {
            const files = fs.readdirSync(DOWNLOADS_DIR);
            for (const f of files) {
                if (f.startsWith('.') || f === 'maps') continue;
                const fullPath = path.join(DOWNLOADS_DIR, f);
                const stat = fs.statSync(fullPath);
                if (stat.isFile() && f.endsWith('.zim')) {
                    items.push({
                        id: f,
                        name: f.replace('.zim', ''),
                        type: 'zim',
                        sizeBytes: stat.size,
                        relativePath: f,
                        date: stat.mtime
                    });
                }
            }
        } catch (err) { }

        // 2. Offline Map Tiles
        try {
            const mapsPath = path.join(DOWNLOADS_DIR, 'maps');
            if (fs.existsSync(mapsPath)) {
                const size = getDirSize(mapsPath);
                if (size > 0) {
                    items.push({
                        id: 'osm-tiles-local',
                        name: 'Offline Map Tiles',
                        type: 'map',
                        sizeBytes: size,
                        relativePath: 'maps/',
                        date: fs.statSync(mapsPath).mtime
                    });
                }
            }
        } catch (err) { }

        // 3. Ollama Models
        try {
            const { execSync } = require('child_process');
            // Format: NAME               ID              SIZE      MODIFIED
            // tinyllama:latest      ...             637 MB    2 weeks ago
            const output = execSync('ollama list', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
            const lines = output.trim().split('\n').slice(1); // skip header
            for (const line of lines) {
                const parts = line.trim().split(/\s{2,}/);
                if (parts.length >= 3) {
                    const name = parts[0];
                    const sizeStr = parts[2]; // e.g., "637 MB" or "4.1 GB"
                    let sizeBytes = 0;
                    if (sizeStr.includes('GB')) sizeBytes = parseFloat(sizeStr) * 1024 * 1024 * 1024;
                    else if (sizeStr.includes('MB')) sizeBytes = parseFloat(sizeStr) * 1024 * 1024;
                    else if (sizeStr.includes('KB')) sizeBytes = parseFloat(sizeStr) * 1024;

                    // Exclude specific embedding models if needed
                    if (!name.includes('nomic')) {
                        items.push({
                            id: name,
                            name: 'LLM: ' + name,
                            type: 'ollama',
                            sizeBytes: sizeBytes,
                            relativePath: 'ollama internal registry',
                            date: new Date()
                        });
                    }
                }
            }
        } catch (err) { }

        res.json({ files: items });
    });

    // Fetch exact download sizes dynamically
    router.get('/sizes', async (req, res) => {
        const sizes = {};

        // 1. Fetch ZIM sizes from Kiwix
        const zimDirs = [
            { id: 'wiki-en-simple', url: 'https://download.kiwix.org/zim/wikipedia/', pattern: 'wikipedia_en_simple_all_maxi_\\d{4}-\\d{2}\\.zim' },
            { id: 'wiki-en-nopic', url: 'https://download.kiwix.org/zim/wikipedia/', pattern: 'wikipedia_en_all_nopic_\\d{4}-\\d{2}\\.zim' },
            { id: 'wikibooks', url: 'https://download.kiwix.org/zim/wikibooks/', pattern: 'wikibooks_en_all_maxi_\\d{4}-\\d{2}\\.zim' },
            { id: 'ifixit', url: 'https://download.kiwix.org/zim/ifixit/', pattern: 'ifixit_en_all_\\d{4}-\\d{2}\\.zim' },
            { id: 'stackexchange', url: 'https://download.kiwix.org/zim/stack_exchange/', pattern: 'stackoverflow\\.com_en_all_\\d{4}-\\d{2}\\.zim' },
            { id: 'medref', url: 'https://download.kiwix.org/zim/other/', pattern: 'mdwiki_en_all_maxi_\\d{4}-\\d{2}\\.zim' }
        ];

        // Group by directory to minimize HTTP requests
        const dirs = [...new Set(zimDirs.map(z => z.url))];
        for (const dirUrl of dirs) {
            try {
                const html = await httpsGet(dirUrl);
                const itemsInDir = zimDirs.filter(z => z.url === dirUrl);
                for (const item of itemsInDir) {
                    try {
                        // Look for the exact filename and capture the size on the same line
                        // Example: <a href="wikibooks_en_all_maxi_2026-01.zim">...</a> 2026-01-28 02:06 5.1G
                        const regex = new RegExp(`href="(${item.pattern})"[^>]*>.*?</a>\\s+\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}\\s+([0-9.]+[KMG])`, 'g');
                        let latestMatch = null;
                        let latestSize = null;
                        let m;
                        while ((m = regex.exec(html)) !== null) {
                            latestMatch = m[1];
                            latestSize = m[2]; // e.g., "5.1G" or "800M"
                        }

                        if (!latestSize) {
                            // Fallback regex if date format differs
                            const fallbackRegex = new RegExp(`href="(${item.pattern})"[^>]*>.*?</a>.*?([0-9.]+[KMG])(?:\\s*<|\\n|$)`, 'gi');
                            while ((m = fallbackRegex.exec(html)) !== null) {
                                latestSize = m[2];
                            }
                        }

                        if (latestSize) {
                            // Convert K/M/G to standard MB/GB display
                            let formatted = latestSize.replace('G', ' GB').replace('M', ' MB').replace('K', ' KB');
                            sizes[item.id] = formatted;
                        }
                    } catch (e) { console.error(`Failed to parse size for ${item.id}`); }
                }
            } catch (e) {
                console.error(`Failed to fetch Kiwix directory: ${dirUrl}`);
            }
        }

        // 2. Fetch Ollama model sizes from registry API
        const ollamaModels = {
            'llm-tinyllama': 'tinyllama:latest',
            'llm-phi3-mini': 'phi3:mini',
            'llm-gemma2': 'gemma2:2b',
            'llm-llama3': 'llama3.2:3b',
            'llm-mistral': 'mistral:latest',
            'llm-meditron': 'meditron:latest'
        };

        for (const [id, modelTag] of Object.entries(ollamaModels)) {
            try {
                const [model, tag] = modelTag.split(':');
                const url = `https://registry.ollama.ai/v2/library/${model}/manifests/${tag}`;
                const manifestText = await httpsGet(url, { 'Accept': 'application/vnd.docker.distribution.manifest.v2+json' });
                const manifest = JSON.parse(manifestText);
                if (manifest.config && manifest.config.size) {
                    let totalBytes = manifest.config.size;
                    if (manifest.layers) {
                        totalBytes += manifest.layers.reduce((acc, layer) => acc + layer.size, 0);
                    }
                    sizes[id] = (totalBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                }
            } catch (e) {
                // Ignore API parsing errors
            }
        }

        res.json(sizes);
    });

    // ============================================================
    // LAN CONTENT SYNC — Share downloaded content between CyberDecks
    // ============================================================

    // Public endpoint: List downloadable content with license metadata
    // Other CyberDeck nodes call this to see what we have available
    router.get('/library', (req, res) => {
        const items = [];

        // 1. ZIM files and other downloaded content
        try {
            const files = fs.readdirSync(DOWNLOADS_DIR);
            for (const f of files) {
                if (f.startsWith('.') || f === 'maps' || f.endsWith('.license.json')) continue;
                const fullPath = path.join(DOWNLOADS_DIR, f);
                const stat = fs.statSync(fullPath);
                if (!stat.isFile()) continue;

                const item = {
                    filename: f,
                    type: f.endsWith('.zim') ? 'zim' : 'file',
                    sizeBytes: stat.size,
                    sizeMB: (stat.size / (1024 * 1024)).toFixed(1),
                    modified: stat.mtime,
                    pullable: true
                };

                // Attach license sidecar if it exists
                const baseName = f.replace(/\.[^.]+$/, '');
                const sidecarPath = path.join(DOWNLOADS_DIR, `${baseName}.license.json`);
                try {
                    if (fs.existsSync(sidecarPath)) {
                        item.license = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
                    }
                } catch (e) { }

                items.push(item);
            }
        } catch (e) { }

        // 2. Ollama Models
        try {
            const { execSync } = require('child_process');
            const output = execSync('ollama list', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
            const lines = output.trim().split('\n').slice(1);
            for (const line of lines) {
                const parts = line.trim().split(/\s{2,}/);
                if (parts.length >= 3) {
                    const modelName = parts[0];
                    const sizeStr = parts[2];
                    let sizeBytes = 0;
                    if (sizeStr.includes('GB')) sizeBytes = parseFloat(sizeStr) * 1024 * 1024 * 1024;
                    else if (sizeStr.includes('MB')) sizeBytes = parseFloat(sizeStr) * 1024 * 1024;

                    if (!modelName.includes('nomic')) {
                        const item = {
                            filename: modelName,
                            type: 'ollama',
                            sizeBytes,
                            sizeMB: (sizeBytes / (1024 * 1024)).toFixed(1),
                            pullable: true  // Enabled pulling Ollama models
                        };

                        // Check for license sidecar
                        const sidecarPath = path.join(DOWNLOADS_DIR, `${modelName.replace(/[:/]/g, '-')}.license.json`);
                        try {
                            if (fs.existsSync(sidecarPath)) {
                                item.license = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
                            }
                        } catch (e) { }

                        items.push(item);
                    }
                }
            }
        } catch (e) { }

        res.json({
            node: os.hostname(),
            items,
            timestamp: new Date().toISOString()
        });
    });

    // Public endpoint: Serve a file to a requesting peer (supports Range for resumable)
    router.get('/serve/:filename', (req, res) => {
        const filename = req.params.filename;
        // Sanitize — prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(DOWNLOADS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stat = fs.statSync(filePath);
        const range = req.headers.range;

        if (range) {
            // Resumable download support
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            const chunkSize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': stat.size,
                'Content-Type': 'application/octet-stream',
                'Accept-Ranges': 'bytes',
                'Content-Disposition': `attachment; filename="${filename}"`
            });
            fs.createReadStream(filePath).pipe(res);
        }
    });

    // Proxy: Fetch a peer's content library (bypasses CORS/mixed-content)
    router.post('/peer/library', async (req, res) => {
        const { peerIp } = req.body;
        if (!peerIp) return res.status(400).json({ error: 'Missing peerIp' });

        // SSRF Protection
        if (!isPrivateIp(peerIp)) {
            return res.status(400).json({ error: 'Invalid peer IP: must be a private network address' });
        }

        try {
            const port = config.httpsPort || 8443;
            const url = `https://${peerIp}:${port}/api/store/library`;
            console.log(`[LAN Sync] Fetching library from peer: ${url}`);

            const response = await fetch(url, { timeout: 15000, agent });
            const data = await response.json();
            res.json({ success: true, peer: peerIp, ...data });
        } catch (e) {
            res.json({ success: false, error: e.message, peer: peerIp, items: [] });
        }
    });

    // Serve Ollama blobs for P2P sync
    router.get('/peer/ollama/blobs/:digest', async (req, res) => {
        const { digest } = req.params;
        const ollamaServeBase = process.env.OLLAMA_MODELS || (process.platform === 'win32'
            ? path.join(process.env.USERPROFILE, '.ollama', 'models')
            : path.join(os.homedir(), '.ollama', 'models'));

        const safeDigest = digest.replace(':', '-');
        const blobPath = path.join(ollamaServeBase, 'blobs', safeDigest);

        if (fs.existsSync(blobPath)) {
            res.sendFile(blobPath);
        } else {
            res.status(404).send('Blob not found');
        }
    });

    // Serve Ollama manifests for P2P sync
    router.get('/peer/ollama/manifest/:model', async (req, res) => {
        const { model } = req.params;
        const [repo, tag] = model.includes(':') ? model.split(':') : [model, 'latest'];
        const ollamaBase = process.env.OLLAMA_MODELS || (process.platform === 'win32'
            ? path.join(process.env.USERPROFILE, '.ollama', 'models')
            : path.join(os.homedir(), '.ollama', 'models'));

        // Check both library/repo and just repo (Ollama sometimes nests differently)
        const pathsToTry = [
            path.join(ollamaBase, 'manifests', 'registry.ollama.ai', 'library', repo, tag),
            path.join(ollamaBase, 'manifests', 'registry.ollama.ai', repo, tag)
        ];

        let manifestPath = pathsToTry[0];
        for (const p of pathsToTry) {
            if (fs.existsSync(p)) {
                manifestPath = p;
                break;
            }
        }

        if (fs.existsSync(manifestPath)) {
            res.sendFile(manifestPath);
        } else {
            res.status(404).send('Manifest not found');
        }
    });

    // Proxy: Pull a file from a peer CyberDeck into our downloads
    router.post('/peer/pull', async (req, res) => {
        const { peerIp, filename, licenseData, type } = req.body;
        if (!peerIp || !filename) return res.status(400).json({ error: 'Missing peerIp or filename' });

        // SSRF Protection
        if (!isPrivateIp(peerIp)) {
            return res.status(400).json({ error: 'Invalid peer IP: must be a private network address' });
        }

        // Sanitize
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const dest = path.join(DOWNLOADS_DIR, filename);
        const dlId = `peer-${filename}`;

        // Check if already downloading
        if (activeDownloads.has(dlId) && ['downloading', 'discovering'].includes(activeDownloads.get(dlId)?.status)) {
            return res.json({ success: true, downloadId: dlId, message: 'Already downloading' });
        }
        activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: `Pulling from nearby CyberDeck (${peerIp})...`, type: type || 'zim', dest });

        try {
            const port = config.httpsPort || 8443;
            const url = `https://${peerIp}:${port}/api/store/serve/${encodeURIComponent(filename)}`;
            console.log(`[LAN Sync] Pulling ${filename} from peer: ${url}`);

            if (type === 'ollama' || filename.includes(':')) {
                // TRUE OFFLINE P2P OLLAMA SYNC - Run in background to avoid blocking response
                (async () => {
                    try {
                        // [NEW] Check if local Ollama is running before pulling
                        const ollamaPort = config.services?.ollama?.port || 11434;
                        const healthRes = await fetch(`http://localhost:${ollamaPort}/api/tags`).catch(() => null);
                        if (!healthRes || !healthRes.ok) {
                            throw new Error('Local Ollama is not running. Please start it from the Admin Panel first.');
                        }

                        activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: `Synchronizing AI Model from peer (${peerIp})...`, type: 'ollama', dest: '' });

                        // Correct Internal API path (matches routes above)
                        const baseUrl = `https://${peerIp}:${port}/api/store`;
                        const manifestRes = await fetch(`${baseUrl}/ollama/manifest/${encodeURIComponent(filename)}`, { agent });
                        if (!manifestRes.ok) throw new Error(`Peer does not have manifest for ${filename} (Status: ${manifestRes.status})`);

                        const manifest = await manifestRes.json();
                        const blobs = [manifest.config, ...manifest.layers];
                        const totalModelSize = blobs.reduce((sum, b) => sum + (b.size || 0), 0);
                        let completedBlobs = 0;

                        const pdl = activeDownloads.get(dlId) || {};
                        activeDownloads.set(dlId, {
                            ...pdl,
                            status: 'downloading',
                            progress: 0,
                            totalBytes: totalModelSize,
                            progressBytes: 0,
                            subDownloads: {}
                        });

                        let ollamaBase = process.env.OLLAMA_MODELS || (process.platform === 'win32'
                            ? path.join(process.env.USERPROFILE, '.ollama', 'models')
                            : path.join(os.homedir(), '.ollama', 'models'));

                        let blobsDir = path.join(ollamaBase, 'blobs');
                        try {
                            if (!fs.existsSync(blobsDir)) fs.mkdirSync(blobsDir, { recursive: true });
                        } catch (e) {
                            console.warn(`[Ollama Sync] Cannot write to ${blobsDir}, falling back to local downloads dir`);
                            ollamaBase = path.join(DOWNLOADS_DIR, '.ollama', 'models');
                            blobsDir = path.join(ollamaBase, 'blobs');
                            if (!fs.existsSync(blobsDir)) fs.mkdirSync(blobsDir, { recursive: true });
                        }

                        for (const blob of blobs) {
                            const digest = blob.digest;
                            const targetPath = path.join(blobsDir, digest.replace(':', '-'));

                            console.log(`[Ollama Sync] Checking blob: ${digest}`);
                            if (!fs.existsSync(targetPath)) {
                                console.log(`[Ollama Sync] Pulling missing blob: ${digest}`);
                                const blobUrl = `${baseUrl}/ollama/blobs/${encodeURIComponent(digest)}`;

                                // pass dlId as parentDlId so downloadFile updates the main progress
                                await downloadFile(blobUrl, targetPath, `${dlId}-${digest}`, activeDownloads, activeProcesses, 5, true, dlId);
                            } else {
                                console.log(`[Ollama Sync] Blob already exists: ${digest}`);
                                // Mark as already downloaded in the parent tracker
                                const d = activeDownloads.get(dlId) || {};
                                const subDownloads = d.subDownloads || {};
                                subDownloads[`${dlId}-${digest}`] = { downloaded: blob.size || 0, total: blob.size || 0 };

                                // Calculate aggregate progress immediately for existing blobs
                                let totalDownloaded = 0;
                                let totalToDownload = d.totalBytes || 0;
                                Object.values(subDownloads).forEach(sub => { totalDownloaded += sub.downloaded; });

                                activeDownloads.set(dlId, {
                                    ...d,
                                    subDownloads,
                                    progressBytes: totalDownloaded,
                                    progress: totalToDownload > 0 ? Math.round((totalDownloaded / totalToDownload) * 100) : d.progress
                                });
                            }

                            completedBlobs++;
                            const d = activeDownloads.get(dlId) || {};
                            d.output = `Syncing layers... ${completedBlobs}/${blobs.length} complete`;
                            activeDownloads.set(dlId, d);
                        }

                        // Save the manifest locally so local Ollama sees it
                        console.log(`[Ollama Sync] Writing manifest for ${filename}`);
                        const [repo, tag] = filename.includes(':') ? filename.split(':') : [filename, 'latest'];
                        const localManifestPath = path.join(ollamaBase, 'manifests', 'registry.ollama.ai', 'library', repo, tag);
                        fs.mkdirSync(path.dirname(localManifestPath), { recursive: true });
                        fs.writeFileSync(localManifestPath, JSON.stringify(manifest));

                        console.log(`[Ollama Sync] Successfully completed sync for ${filename}`);
                        activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'complete', progress: 100, output: `Model ${filename} synced offline from peer!` });
                    } catch (err) {
                        console.error(`[Ollama Sync] FAILED for ${filename}:`, err.message);
                        activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'failed', output: `Offline sync failed: ${err.message}` });
                    }
                })();

            } else {
                // Download file using existing HTTP stream infrastructure
                downloadFile(url, dest, dlId, activeDownloads, activeProcesses);
            }

            // Write license sidecar if provided
            if (licenseData) {
                try {
                    const baseName = filename.replace(/\.[^.]+$/, '');
                    const sidecarPath = path.join(DOWNLOADS_DIR, `${baseName}.license.json`);
                    fs.writeFileSync(sidecarPath, JSON.stringify({
                        ...licenseData,
                        pulledFrom: peerIp,
                        pulledAt: new Date().toISOString()
                    }, null, 2));
                } catch (e) { console.error('[LAN Sync] Failed to write license sidecar:', e.message); }
            }

            res.json({ success: true, downloadId: dlId, message: `Pulling ${filename} from ${peerIp}` });
        } catch (err) {
            activeDownloads.set(dlId, { status: 'failed', progress: 0, output: err.message });
            res.json({ success: false, downloadId: dlId, error: err.message });
        }
    });

    return router;
};

function parseProgress(output) {
    const pctMatch = output.match(/(\d+)%/g);
    if (pctMatch) {
        const last = pctMatch[pctMatch.length - 1];
        return parseInt(last);
    }
    return 0;
}
