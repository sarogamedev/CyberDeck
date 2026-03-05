const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

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
function downloadFile(url, dest, dlId, activeDownloads, activeProcesses, maxRedirects = 5) {
    const fileName = path.basename(dest);
    const proto = url.startsWith('https') ? https : http;

    // Check existing file size for resuming
    let startByte = 0;
    if (fs.existsSync(dest)) {
        startByte = fs.statSync(dest).size;
    }

    const options = {
        headers: {}
    };
    if (startByte > 0) {
        options.headers['Range'] = `bytes=${startByte}-`;
    }

    const req = proto.get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (maxRedirects <= 0) {
                activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'failed', progress: 0, output: 'Too many redirects' });
                return;
            }
            const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
            return downloadFile(next, dest, dlId, activeDownloads, activeProcesses, maxRedirects - 1);
        }

        // 416 means Range Not Satisfiable (file is already fully downloaded based on our startByte)
        if (res.statusCode === 416) {
            res.resume();
            activeProcesses.delete(dlId);
            activeDownloads.set(dlId, {
                ...activeDownloads.get(dlId),
                status: 'complete', progress: 100,
                output: `Downloaded: ${fileName}\nSaved to: ${dest}`
            });
            return;
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'failed', progress: 0, output: `HTTP error ${res.statusCode} for ${url}` });
            return;
        }

        // If it's 200 (server doesn't support Range), we must start over
        if (res.statusCode === 200 && startByte > 0) {
            startByte = 0;
        }

        const contentLength = parseInt(res.headers['content-length'], 10) || 0;
        const totalSize = startByte + contentLength;
        let downloaded = startByte;

        // Use 'a' flag to append if we are resuming
        const flags = res.statusCode === 206 ? 'a' : 'w';
        const fileStream = fs.createWriteStream(dest, { flags });

        res.on('data', (chunk) => {
            downloaded += chunk.length;
            const pct = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;
            const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
            const totalMB = totalSize > 0 ? (totalSize / (1024 * 1024)).toFixed(1) : '?';
            const dl = activeDownloads.get(dlId) || {};

            // Allow caller to transition to 'paused' without being overwritten
            if (dl.status === 'paused' || dl.status === 'cancelled') {
                req.destroy();
                return;
            }

            activeDownloads.set(dlId, {
                ...dl,
                status: 'downloading',
                progress: pct,
                progressBytes: downloaded,
                totalBytes: totalSize,
                output: `${fileName}\n${dlMB} MB / ${totalMB} MB (${pct}%)`
            });
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
            fileStream.close();
            activeProcesses.delete(dlId);
            const dl = activeDownloads.get(dlId) || {};
            if (dl.status !== 'cancelled' && dl.status !== 'paused') {
                // SHA256 Integrity Verification
                const hash = crypto.createHash('sha256');
                const verifyStream = fs.createReadStream(dest);
                verifyStream.on('data', (chunk) => hash.update(chunk));
                verifyStream.on('end', () => {
                    const fileHash = hash.digest('hex');
                    const expectedHash = dl.expectedSha256;
                    let hashStatus = `SHA256: ${fileHash.substring(0, 16)}...`;

                    if (expectedHash) {
                        if (fileHash === expectedHash) {
                            hashStatus = `✓ Verified (SHA256: ${fileHash.substring(0, 16)}...)`;
                            console.log(`[Store] ✓ Hash verified for ${fileName}`);
                        } else {
                            console.error(`[Store] ✗ Hash mismatch for ${fileName}! Expected: ${expectedHash}, Got: ${fileHash}`);
                            try { fs.unlinkSync(dest); } catch (e) { }
                            activeDownloads.set(dlId, {
                                ...dl, status: 'corrupted', progress: 0,
                                output: `✗ INTEGRITY FAILURE: ${fileName}\nExpected: ${expectedHash}\nGot: ${fileHash}\nFile deleted. Please retry.`
                            });
                            return;
                        }
                    }

                    // Write sidecar license file
                    if (dl.licenseMetadata) {
                        try {
                            const sidecarPath = dest.replace(/\.[^.]+$/, '') + '.license.json';
                            fs.writeFileSync(sidecarPath, JSON.stringify({ ...dl.licenseMetadata, sha256: fileHash }, null, 2));
                            console.log(`[Store] License sidecar written: ${sidecarPath}`);
                        } catch (e) { console.error('[Store] Failed to write license sidecar:', e.message); }
                    }

                    activeDownloads.set(dlId, {
                        ...dl, status: 'complete', progress: 100,
                        output: `Downloaded: ${fileName}\nSaved to: ${dest}\n${hashStatus}`
                    });
                });
                verifyStream.on('error', () => {
                    activeDownloads.set(dlId, {
                        ...dl, status: 'complete', progress: 100,
                        output: `Downloaded: ${fileName}\nSaved to: ${dest}\n(Hash check skipped)`
                    });
                });
            }
        });

        fileStream.on('error', (err) => {
            activeProcesses.delete(dlId);
            activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'failed', progress: 0, output: `Write error: ${err.message}` });
        });

        res.on('error', (err) => {
            activeProcesses.delete(dlId);
            if (err.message !== 'aborted') {
                activeDownloads.set(dlId, { ...activeDownloads.get(dlId), status: 'failed', progress: 0, output: `Download error: ${err.message}` });
            }
        });
    });

    req.on('error', (err) => {
        activeProcesses.delete(dlId);
        const dl = activeDownloads.get(dlId) || {};
        if (dl.status !== 'cancelled' && dl.status !== 'paused') {
            activeDownloads.set(dlId, { ...dl, status: 'failed', progress: 0, output: `Connection error: ${err.message}` });
        }
    });

    // Store request reference for cancellation/pausing
    activeProcesses.set(dlId, { type: 'request', req, dest, url, maxRedirects });
}

module.exports = function (config) {
    const router = express.Router();
    const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    // Active downloads tracker
    const activeDownloads = new Map();
    // Track processes/requests for cancellation
    const activeProcesses = new Map();

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
            activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: '', type: 'ollama', modelName: cmd.replace('ollama pull ', '') });

            const proc = exec(cmd, { timeout: 3600000 });
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
    router.post('/pause/:id', (req, res) => {
        const dlId = req.params.id;
        const proc = activeProcesses.get(dlId);
        const dl = activeDownloads.get(dlId);

        if (!dl || dl.type !== 'zim') {
            return res.status(400).json({ error: 'Only file downloads can be paused' });
        }

        if (proc && proc.type === 'request' && proc.req) {
            // Set state to paused, req connection will be destroyed by data event listener
            activeDownloads.set(dlId, { ...dl, status: 'paused', output: `Paused: ${path.basename(proc.dest)}\nPartially downloaded (${dl.progress}%)` });
            proc.req.destroy();

            // Keep the process metadata so we can resume it easily later without client resending full details
            activeProcesses.set(dlId, { ...proc, req: null });
        }
        res.json({ success: true, message: 'Download paused' });
    });

    // Resume a paused download
    router.post('/resume/:id', (req, res) => {
        const dlId = req.params.id;
        const proc = activeProcesses.get(dlId);
        const dl = activeDownloads.get(dlId);

        if (!dl || dl.type !== 'zim' || dl.status !== 'paused') {
            return res.status(400).json({ error: 'Download is not paused or cannot be resumed' });
        }

        if (proc && proc.url && proc.dest) {
            activeDownloads.set(dlId, { ...dl, status: 'downloading', output: `Resuming: ${path.basename(proc.dest)}` });
            downloadFile(proc.url, proc.dest, dlId, activeDownloads, activeProcesses, proc.maxRedirects || 5);
            res.json({ success: true, message: 'Download resumed' });
        } else {
            res.status(400).json({ error: 'Resume context lost' });
        }
    });

    // Cancel an active download
    router.post('/cancel/:id', (req, res) => {
        const dlId = req.params.id;
        const proc = activeProcesses.get(dlId);
        const dl = activeDownloads.get(dlId);

        if (proc) {
            if (proc.type === 'process' && proc.proc) {
                proc.proc.kill('SIGTERM');
            } else if (proc.type === 'request' && proc.req) {
                proc.req.destroy();
            }
            activeProcesses.delete(dlId);
        }

        // Delete partial file
        if (dl && dl.dest) {
            try { fs.unlinkSync(dl.dest); } catch (e) { }
        } else if (proc && proc.dest) {
            try { fs.unlinkSync(proc.dest); } catch (e) { }
        }

        activeDownloads.set(dlId, { status: 'cancelled', progress: 0, output: 'Download cancelled', type: dl?.type });
        res.json({ success: true });
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
            exec(`ollama rm ${dl.modelName}`, { timeout: 30000 }, (err) => {
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
                        absolutePath: fullPath,
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
                        absolutePath: mapsPath,
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
                            absolutePath: 'ollama internal registry',
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
