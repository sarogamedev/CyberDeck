const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = function (config) {
    const router = express.Router();

    // Get map configuration
    router.get('/config', (req, res) => {
        res.json({
            enabled: config.services.maps.enabled,
            defaultCenter: config.services.maps.defaultCenter || [20.5937, 78.9629],
            defaultZoom: config.services.maps.defaultZoom || 5,
            tilesPath: config.services.maps.tilesPath || '',
            tileUrl: config.services.maps.tilesPath
                ? '/api/maps/tiles/{z}/{x}/{y}.png'
                : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors'
        });
    });

    // Serve local tiles if available
    router.get('/tiles/:z/:x/:y', (req, res) => {
        const { z, x, y } = req.params;
        const tilesDir = config.services.maps.tilesPath;

        if (!tilesDir) {
            return res.status(404).json({ error: 'No local tiles configured' });
        }

        // Try common tile directory structures
        const possiblePaths = [
            path.join(tilesDir, z, x, `${y}.png`),
            path.join(tilesDir, z, x, `${y}.jpg`),
            path.join(tilesDir, z, x, `${y}.webp`),
            path.join(tilesDir, `${z}_${x}_${y}.png`)
        ];

        for (const tilePath of possiblePaths) {
            if (fs.existsSync(tilePath)) {
                res.set('Cache-Control', 'public, max-age=604800');
                return res.sendFile(tilePath);
            }
        }

        res.status(404).json({ error: 'Tile not found' });
    });

    const activeTileDownloads = new Map();

    // Helper: lat/lon to OSM tile coordinates
    function lon2tile(lon, zoom) { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
    function lat2tile(lat, zoom) { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

    async function downloadTile(z, x, y, destDir) {
        return new Promise((resolve, reject) => {
            const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
            const dest = path.join(destDir, z.toString(), x.toString(), `${y}.png`);

            if (fs.existsSync(dest)) return resolve(true);

            fs.mkdirSync(path.dirname(dest), { recursive: true });

            const https = require('https');
            const req = https.get(url, { headers: { 'User-Agent': 'CyberDeck/1.0 offline-maps' } }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return resolve(false); // Ignore failed tiles to not crash entire batch
                }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(true); });
                file.on('error', () => { resolve(false); });
            });
            req.on('error', () => resolve(false));
            req.setTimeout(5000, () => { req.destroy(); resolve(false); });
        });
    }

    router.post('/download', async (req, res) => {
        const { bounds, minZoom, maxZoom } = req.body;
        // bounds: { _southWest: { lat, lng }, _northEast: { lat, lng } }

        if (!bounds || minZoom === undefined || maxZoom === undefined) {
            return res.status(400).json({ error: 'Invalid bounds or zoom levels' });
        }

        const dlId = Date.now().toString();
        const destDir = config.services.maps.tilesPath || path.join(__dirname, '..', 'downloads', 'maps');

        // Calculate required tiles
        const tiles = [];
        for (let z = minZoom; z <= maxZoom; z++) {
            const left = lon2tile(bounds._southWest.lng, z);
            const right = lon2tile(bounds._northEast.lng, z);
            const top = lat2tile(bounds._northEast.lat, z);
            const bottom = lat2tile(bounds._southWest.lat, z);

            for (let x = Math.min(left, right); x <= Math.max(left, right); x++) {
                for (let y = Math.min(top, bottom); y <= Math.max(top, bottom); y++) {
                    tiles.push({ z, x, y });
                }
            }
        }

        if (tiles.length === 0) return res.status(400).json({ error: 'No tiles in selection' });
        if (tiles.length > 5000) return res.status(400).json({ error: `Too many tiles selected (${tiles.length}). Max 5,000 per request to respect OSM servers.` });

        res.json({ success: true, downloadId: dlId, totalTiles: tiles.length, message: 'Tile download started' });

        activeTileDownloads.set(dlId, { status: 'downloading', downloaded: 0, total: tiles.length });

        // Background downloader
        (async () => {
            let downloaded = 0;
            for (const tile of tiles) {
                const dl = activeTileDownloads.get(dlId);
                if (!dl || dl.status === 'cancelled') break;

                await downloadTile(tile.z, tile.x, tile.y, destDir);
                downloaded++;

                activeTileDownloads.set(dlId, { ...dl, downloaded });

                // Sleep 150ms between tiles to avoid hammering OSM servers
                await new Promise(r => setTimeout(r, 150));
            }
            const finalState = activeTileDownloads.get(dlId);
            if (finalState && finalState.status !== 'cancelled') {
                activeTileDownloads.set(dlId, { status: 'complete', downloaded: tiles.length, total: tiles.length });

                // Enforce map config path change and enable it
                let configChanged = false;
                if (!config.services.maps.tilesPath) {
                    config.services.maps.tilesPath = destDir;
                    configChanged = true;
                }
                if (!config.services.maps.enabled) {
                    config.services.maps.enabled = true;
                    configChanged = true;
                }

                if (configChanged) {
                    try {
                        const configPath = path.join(__dirname, '..', 'config.json');
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                    } catch (e) { }
                }
            }
        })();
    });

    router.get('/progress/:id', (req, res) => {
        const dl = activeTileDownloads.get(req.params.id);
        if (!dl) return res.status(404).json({ error: 'Not found' });
        res.json(dl);
    });

    router.post('/cancel/:id', (req, res) => {
        const dl = activeTileDownloads.get(req.params.id);
        if (dl) activeTileDownloads.set(req.params.id, { ...dl, status: 'cancelled' });
        res.json({ success: true });
    });

    return router;
};
