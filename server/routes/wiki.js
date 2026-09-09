const express = require('express');

let fetch;
try { fetch = require('node-fetch'); } catch (e) { fetch = null; }

module.exports = function (config) {
    const router = express.Router();
    const kiwixPort = config.services.kiwix.port || 8889;
    const kiwixBase = `http://localhost:${kiwixPort}`;

    // Search Wikipedia
    router.get('/search', async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });
            const query = req.query.q;
            const dataset = req.query.dataset;
            if (!query) return res.status(400).json({ error: 'Query parameter "q" required' });

            let searchUrl = `${kiwixBase}/search?pattern=${encodeURIComponent(query)}&pageLength=20`;
            if (dataset && dataset !== 'all') {
                searchUrl += `&content=${encodeURIComponent(dataset)}`;
            }

            const response = await fetch(searchUrl);
            const html = await response.text();

            // Parse search results from Kiwix HTML
            const results = [];
            const regex = /<a[^>]*href="\/([^"]*)"[^>]*>([^<]*)<\/a>/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                if (match[1] && !match[1].startsWith('search') && !match[1].startsWith('skin')) {
                    results.push({
                        path: match[1],
                        title: match[2].trim(),
                        url: `/api/wiki/article/${encodeURIComponent(match[1])}`
                    });
                }
            }

            res.json({ query, results });
        } catch (err) {
            res.status(500).json({ error: `Kiwix not reachable: ${err.message}` });
        }
    });

    // List available datasets based on local ZIM files
    router.get('/datasets', (req, res) => {
        const path = require('path');
        const fs = require('fs');
        const dlDir = path.join(__dirname, '..', 'downloads');
        let datasets = [];
        try {
            if (fs.existsSync(dlDir)) {
                datasets = fs.readdirSync(dlDir)
                    .filter(f => f.endsWith('.zim'))
                    .map(f => {
                        const id = f.replace('.zim', '');
                        // Map known prefixes to human-readable names
                        let name = id;
                        if (id.startsWith('wikipedia_en_simple')) name = 'Wikipedia (Simple English)';
                        else if (id.startsWith('wikipedia_en')) name = 'Wikipedia (English)';
                        else if (id.startsWith('ifixit')) name = 'iFixit Repair Guides';
                        else if (id.startsWith('wikibooks')) name = 'Wikibooks';
                        else if (id.startsWith('stackoverflow')) name = 'Stack Exchange';
                        else if (id.startsWith('mdwiki')) name = 'Medical Wikipedia';
                        else if (id.startsWith('gutenberg')) name = 'Project Gutenberg';
                        
                        return { id, name };
                    });
            }
        } catch (err) { }
        res.json({ datasets });
    });

    // List available datasets based on local ZIM files
    
    // Get article content
    router.get('/article/*', async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });
            let articlePath = req.params[0] || '';
            // SSRF Protection: Prevent path traversal and absolute URLs
            if (articlePath.includes('..') || articlePath.includes('://')) {
                return res.status(400).json({ error: 'Invalid article path' });
            }

            const response = await fetch(`${kiwixBase}/${articlePath}`);
            const contentType = response.headers.get('content-type');

            if (contentType && contentType.includes('text/html')) {
                let html = await response.text();

                // XSS Protection: Strip scripts and inline event handlers
                html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                html = html.replace(/\s+on[a-z]+=(['"])(?:(?!\1).)*\1/gi, '');

                res.json({
                    title: articlePath,
                    html: html,
                    path: articlePath
                });
            } else {
                // Binary content (images, etc) - pipe through
                res.set('Content-Type', contentType);
                response.body.pipe(res);
            }
        } catch (err) {
            res.status(500).json({ error: `Article fetch failed: ${err.message}` });
        }
    });

    // Serve assets (images, css, etc from Kiwix)
    router.get('/asset/*', async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });
            let assetPath = req.params[0] || '';
            // SSRF Protection: Prevent path traversal and absolute URLs
            if (assetPath.includes('..') || assetPath.includes('://')) {
                return res.status(400).json({ error: 'Invalid asset path' });
            }

            const response = await fetch(`${kiwixBase}/${assetPath}`);
            const contentType = response.headers.get('content-type');
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=86400');
            response.body.pipe(res);
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Check Kiwix status
    router.get('/status', async (req, res) => {
        try {
            if (!fetch) return res.json({ running: false });
            const response = await fetch(kiwixBase, { timeout: 3000 });
            res.json({ running: response.ok });
        } catch (err) {
            res.json({ running: false, error: err.message });
        }
    });

    return router;
};
