const express = require('express');
const path = require('path');
const fs = require('fs');
const { resolveWithin } = require('../utils/safePath');

// Tile coordinates are always non-negative integers. Express URL-decodes route
// params, so an unchecked :z/:x/:y escaped the tile directory.
const TILE_COORD_RE = /^\d{1,10}$/;

module.exports = function (config) {
    const router = express.Router();

    // Helper: resolve tilesPath relative to server dir
    function resolveMapPath(tilesDir) {
        if (!tilesDir) return '';
        if (path.isAbsolute(tilesDir)) return tilesDir;
        return path.join(__dirname, '..', tilesDir);
    }

    // Get map configuration
    router.get('/config', (req, res) => {
        const tilesDir = config.services.maps.tilesPath;
        const resolvedDir = resolveMapPath(tilesDir);
        const hasOfflineTiles = !!(resolvedDir && fs.existsSync(resolvedDir));

        res.json({
            enabled: config.services.maps.enabled,
            hasOfflineTiles,
            defaultCenter: config.services.maps.defaultCenter || [20.5937, 78.9629],
            defaultZoom: config.services.maps.defaultZoom || 5,
            tilesPath: tilesDir || '',
            onlineTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            offlineTileUrl: hasOfflineTiles ? '/api/maps/tiles/{z}/{x}/{y}.png' : '',
            tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', // Always default to online
            attribution: '© OpenStreetMap contributors'
        });
    });

    // Serve local tiles — route explicitly includes .png so :y captures only the number
    function serveTile(req, res) {
        const { z, x, y } = req.params;
        const tilesDir = config.services.maps.tilesPath;

        if (!tilesDir) {
            return res.status(404).end();
        }

        if (!TILE_COORD_RE.test(z) || !TILE_COORD_RE.test(x) || !TILE_COORD_RE.test(y)) {
            return res.status(400).end();
        }

        // Resolve to absolute path (relative paths are resolved from server/ dir)
        const absDir = resolveMapPath(tilesDir);

        let possiblePaths;
        try {
            possiblePaths = [
                resolveWithin(absDir, z, x, `${y}.png`),
                resolveWithin(absDir, z, x, `${y}.jpg`),
                resolveWithin(absDir, z, x, `${y}.webp`),
                resolveWithin(absDir, `${z}_${x}_${y}.png`)
            ];
        } catch (err) {
            return res.status(400).end();
        }

        for (const tilePath of possiblePaths) {
            if (fs.existsSync(tilePath)) {
                res.set('Cache-Control', 'public, max-age=604800');
                return res.sendFile(tilePath);
            }
        }

        res.status(404).end();
    }

    router.get('/tiles/:z/:x/:y.png', serveTile);
    router.get('/tiles/:z/:x/:y.jpg', serveTile);
    router.get('/tiles/:z/:x/:y.webp', serveTile);
    // Fallback with no extension (just in case)
    router.get('/tiles/:z/:x/:y', serveTile);

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

    const MAX_TILES = 5000;

    router.post('/download', async (req, res) => {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { bounds, minZoom, maxZoom } = req.body || {};
        // bounds: { _southWest: { lat, lng }, _northEast: { lat, lng } }

        const sw = bounds && bounds._southWest;
        const ne = bounds && bounds._northEast;
        const finite = (v) => typeof v === 'number' && Number.isFinite(v);
        if (!finite(sw?.lat) || !finite(sw?.lng) || !finite(ne?.lat) || !finite(ne?.lng)) {
            return res.status(400).json({ error: 'Invalid bounds' });
        }
        if (Math.abs(sw.lat) > 85 || Math.abs(ne.lat) > 85 ||
            Math.abs(sw.lng) > 180 || Math.abs(ne.lng) > 180) {
            return res.status(400).json({ error: 'Bounds out of range' });
        }

        const zMin = Number(minZoom);
        const zMax = Number(maxZoom);
        if (!Number.isInteger(zMin) || !Number.isInteger(zMax) ||
            zMin < 0 || zMax > 19 || zMin > zMax) {
            return res.status(400).json({ error: 'Zoom levels must be integers between 0 and 19' });
        }

        const dlId = Date.now().toString();
        const destDir = path.resolve(config.services.maps.tilesPath || path.join(__dirname, '..', 'downloads', 'maps'));

        // Count first, then build. The array used to be fully materialised
        // before the size check, so a world-bounds request at high zoom
        // exhausted memory before the guard ever ran.
        let projected = 0;
        for (let z = zMin; z <= zMax; z++) {
            const left = lon2tile(sw.lng, z);
            const right = lon2tile(ne.lng, z);
            const top = lat2tile(ne.lat, z);
            const bottom = lat2tile(sw.lat, z);
            const wide = Math.abs(right - left) + 1;
            const tall = Math.abs(bottom - top) + 1;
            projected += wide * tall;
            if (projected > MAX_TILES) {
                return res.status(400).json({
                    error: `Too many tiles selected. Max ${MAX_TILES} per request to respect OSM servers.`
                });
            }
        }
        if (projected === 0) return res.status(400).json({ error: 'No tiles in selection' });

        const tiles = [];
        for (let z = zMin; z <= zMax; z++) {
            const left = lon2tile(sw.lng, z);
            const right = lon2tile(ne.lng, z);
            const top = lat2tile(ne.lat, z);
            const bottom = lat2tile(sw.lat, z);

            for (let x = Math.min(left, right); x <= Math.max(left, right); x++) {
                for (let y = Math.min(top, bottom); y <= Math.max(top, bottom); y++) {
                    tiles.push({ z, x, y });
                }
            }
        }

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
                    // Store as relative path for portability
                    config.services.maps.tilesPath = './downloads/maps';
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
                        console.log('[Maps] Config updated: tilesPath=' + config.services.maps.tilesPath);
                    } catch (e) {
                        console.error('[Maps] Failed to write config.json:', e.message);
                    }
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
