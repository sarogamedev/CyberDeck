const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = function (config) {
    const router = express.Router();
    const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    // Active downloads tracker
    const activeDownloads = new Map();

    // Get content catalog
    router.get('/catalog', (req, res) => {
        res.json({
            categories: [
                {
                    name: 'Wikipedia & Knowledge',
                    icon: '📚',
                    items: [
                        { id: 'wiki-en-mini', name: 'Wikipedia English (Mini)', desc: 'Condensed encyclopedia, top articles', size: '1.2 GB', url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_simple_all_mini.zim', type: 'zim' },
                        { id: 'wiki-en-nopic', name: 'Wikipedia English (No Pictures)', desc: 'Full articles, no images', size: '10 GB', url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_nopic.zim', type: 'zim' },
                        { id: 'wiki-en-full', name: 'Wikipedia English (Full)', desc: 'Complete with images', size: '97 GB', url: 'https://download.kiwix.org/zim/wikipedia/', type: 'zim' },
                        { id: 'wikibooks', name: 'Wikibooks English', desc: 'Open textbooks and manuals', size: '700 MB', url: 'https://download.kiwix.org/zim/wikibooks/', type: 'zim' },
                        { id: 'wikihow', name: 'WikiHow', desc: 'How-to guides for everything', size: '5 GB', url: 'https://download.kiwix.org/zim/other/', type: 'zim' },
                        { id: 'stackexchange', name: 'StackOverflow', desc: 'Programming Q&A archive', size: '8 GB', url: 'https://download.kiwix.org/zim/stack_exchange/', type: 'zim' }
                    ]
                },
                {
                    name: 'LLM Models',
                    icon: '🧠',
                    items: [
                        { id: 'llm-tinyllama', name: 'TinyLlama 1.1B', desc: 'Ultra-light, basic conversations', size: '637 MB', cmd: 'ollama pull tinyllama', type: 'ollama' },
                        { id: 'llm-phi3-mini', name: 'Phi-3 Mini 3.8B', desc: 'Good reasoning, small size', size: '2.2 GB', cmd: 'ollama pull phi3:mini', type: 'ollama' },
                        { id: 'llm-gemma2', name: 'Gemma 2 2B', desc: 'Google, efficient and smart', size: '1.6 GB', cmd: 'ollama pull gemma2:2b', type: 'ollama' },
                        { id: 'llm-llama3', name: 'Llama 3.2 3B', desc: 'Meta, strong general purpose', size: '2.0 GB', cmd: 'ollama pull llama3.2:3b', type: 'ollama' },
                        { id: 'llm-mistral', name: 'Mistral 7B', desc: 'Best quality, needs 8GB+ RAM', size: '4.1 GB', cmd: 'ollama pull mistral', type: 'ollama' },
                        { id: 'llm-meditron', name: 'Meditron 7B', desc: 'Medical-specialized LLM', size: '4.1 GB', cmd: 'ollama pull meditron', type: 'ollama' }
                    ]
                },
                {
                    name: 'Survival Knowledge Packs',
                    icon: '🛡️',
                    items: [
                        { id: 'gutenberg', name: 'Project Gutenberg Top 100', desc: '100 classic books (EPUB)', size: '200 MB', url: 'https://www.gutenberg.org/', type: 'manual' },
                        { id: 'medref', name: 'WHO Medical Reference', desc: 'Essential medicines + first aid', size: '50 MB', url: 'https://www.who.int/publications', type: 'manual' },
                        { id: 'survival-fm', name: 'US Army Survival Manual FM 21-76', desc: 'Comprehensive field survival', size: '15 MB', url: 'https://archive.org/', type: 'manual' }
                    ]
                },
                {
                    name: 'Maps & Navigation',
                    icon: '🗺️',
                    items: [
                        { id: 'osm-tiles-country', name: 'Offline Map Tiles (Your Country)', desc: 'Download tiles for offline use', size: 'Varies', url: 'https://openmaptiles.org/', type: 'manual' }
                    ]
                }
            ]
        });
    });

    // Download a ZIM file
    router.post('/download', (req, res) => {
        const { id, url, cmd, type } = req.body;

        if (type === 'ollama') {
            // Pull LLM model
            const dlId = id;
            activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: '' });

            const proc = exec(cmd, { timeout: 3600000 }); // 1hr timeout
            let output = '';
            proc.stdout?.on('data', (d) => {
                output += d;
                activeDownloads.set(dlId, { status: 'downloading', progress: parseProgress(output), output });
            });
            proc.stderr?.on('data', (d) => {
                output += d;
                activeDownloads.set(dlId, { status: 'downloading', progress: parseProgress(output), output });
            });
            proc.on('close', (code) => {
                activeDownloads.set(dlId, { status: code === 0 ? 'complete' : 'failed', progress: 100, output });
            });

            res.json({ success: true, downloadId: dlId, message: 'Model download started' });
        } else if (type === 'zim' && url) {
            // Download ZIM file with curl (preferred on Termux) or wget
            const dlId = id;
            const dest = path.join(DOWNLOADS_DIR, id + '.zim');
            activeDownloads.set(dlId, { status: 'downloading', progress: 0, output: '' });

            // Prefer curl (available by default on most systems), fall back to wget
            exec('which curl', (err) => {
                const dlCmd = err
                    ? `wget -c -O "${dest}" "${url}" 2>&1`
                    : `curl -L -C - -o "${dest}" --progress-bar "${url}" 2>&1`;

                const proc = exec(dlCmd, { timeout: 86400000 }); // 24hr timeout
                let output = '';
                proc.stdout?.on('data', (d) => {
                    output += d;
                    const pctMatch = d.toString().match(/(\d+)%/);
                    const pct = pctMatch ? parseInt(pctMatch[1]) : 0;
                    activeDownloads.set(dlId, { status: 'downloading', progress: pct, output: output.slice(-500) });
                });
                proc.stderr?.on('data', (d) => {
                    output += d;
                    const pctMatch = d.toString().match(/(\d+(?:\.\d+)?)%/);
                    const pct = pctMatch ? Math.round(parseFloat(pctMatch[1])) : activeDownloads.get(dlId)?.progress || 0;
                    activeDownloads.set(dlId, { status: 'downloading', progress: pct, output: output.slice(-500) });
                });
                proc.on('close', (code) => {
                    activeDownloads.set(dlId, {
                        status: code === 0 ? 'complete' : 'failed',
                        progress: code === 0 ? 100 : 0,
                        output: code === 0 ? `Downloaded to ${dest}` : 'Download failed. Install curl or wget: pkg install curl'
                    });
                });
            });

            res.json({ success: true, downloadId: dlId, message: 'Download started' });
        } else if (type === 'manual') {
            res.json({ success: true, downloadId: id, message: 'Manual download — visit the URL and save files to your device', url });
        } else {
            res.status(400).json({ error: 'Invalid download request' });
        }
    });

    // Check download progress
    router.get('/progress/:id', (req, res) => {
        const dl = activeDownloads.get(req.params.id);
        if (!dl) return res.json({ status: 'not_found' });
        res.json(dl);
    });

    // List downloaded content
    router.get('/downloaded', (req, res) => {
        try {
            const files = fs.readdirSync(DOWNLOADS_DIR)
                .filter(f => !f.startsWith('.'))
                .map(f => {
                    const stat = fs.statSync(path.join(DOWNLOADS_DIR, f));
                    return { name: f, size: stat.size, date: stat.mtime };
                });
            res.json({ files });
        } catch (err) {
            res.json({ files: [] });
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
