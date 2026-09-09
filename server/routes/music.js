const express = require('express');
const path = require('path');
const { parseRange, sendUnsatisfiable } = require('../utils/httpRange');
const fs = require('fs');
const { scanDirectory, decodeFileId, getMimeType } = require('../utils/scanner');

let mm;
try { mm = require('music-metadata'); } catch (e) { mm = null; }

module.exports = function (config) {
    const router = express.Router();
    let library = [];
    let lastScan = 0;

    const AUDIO_EXTS = ['flac', 'mp3', 'ogg', 'wav', 'aac', 'm4a', 'wma', 'opus'];

    async function scanLibrary() {
        const now = Date.now();
        // 1-minute cache
        if (library.length > 0 && now - lastScan < 60000) {
            return library;
        }

        console.log(`[Music] Scanning: ${config.paths.music}`);
        const files = scanDirectory(config.paths.music, AUDIO_EXTS);
        
        if (mm) {
            for (const file of files) {
                try {
                    const fullPath = path.join(config.paths.music, file.relativePath);
                    // Extract all metadata, including the picture array to correctly set hasCover
                    const metadata = await mm.parseFile(fullPath);
                    file.title = metadata.common.title || path.parse(file.name).name;
                    file.artist = metadata.common.artist || 'Unknown Artist';
                    file.album = metadata.common.album || 'Unknown Album';
                    file.year = metadata.common.year || null;
                    file.duration = metadata.format.duration || 0;
                    file.format = metadata.format.codec || file.ext.toUpperCase();
                    // We check if cover exists but don't extract yet
                    file.hasCover = metadata.common.picture && metadata.common.picture.length > 0;
                    console.log(`[Music] Metadata OK: "${file.title}" by ${file.artist}`);
                } catch (err) {
                    console.warn(`[Music] Metadata failed for ${file.name}: ${err.message}`);
                    file.title = path.parse(file.name).name;
                    file.artist = 'Unknown Artist';
                    file.album = 'Unknown Album';
                    file.duration = 0;
                    file.format = file.ext.toUpperCase();
                    file.hasCover = false;
                }
            }
        } else {
            for (const file of files) {
                file.title = path.parse(file.name).name;
                file.artist = 'Unknown Artist';
                file.album = 'Unknown Album';
                file.duration = 0;
                file.format = file.ext.toUpperCase();
                file.hasCover = false;
            }
        }

        library = files;
        lastScan = now;
        return library;
    }

    // List all music
    router.get('/', async (req, res) => {
        try {
            const lib = await scanLibrary();
            // Group by album
            const albums = {};
            for (const track of lib) {
                const key = track.album || 'Unknown Album';
                if (!albums[key]) albums[key] = { name: key, artist: track.artist, tracks: [] };
                albums[key].tracks.push(track);
            }
            res.json({
                total: lib.length,
                tracks: lib,
                albums: Object.values(albums)
            });
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Stream audio file
    router.get('/stream/:id', (req, res) => {
        try {
            const filePath = decodeFileId(req.params.id, config.paths.music);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

            const stat = fs.statSync(filePath);
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const mime = getMimeType(ext);

            // Support range requests for seeking
            const range = req.headers.range;
            const parsed = parseRange(range, stat.size);
            if (parsed === 'unsatisfiable') return sendUnsatisfiable(res, stat.size);

            if (parsed) {
                const { start, end } = parsed;
                const chunkSize = end - start + 1;

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': mime
                });
                fs.createReadStream(filePath, { start, end }).pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Length': stat.size,
                    'Content-Type': mime
                });
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Get album cover
    router.get('/cover/:id', async (req, res) => {
        try {
            // decodeFileId returns the absolute path if rootDir is provided
            const filePath = decodeFileId(req.params.id, config.paths.music);
            if (!fs.existsSync(filePath) || !mm) {
                return res.status(404).json({ error: 'Cover not available' });
            }

            const metadata = await mm.parseFile(filePath);
            const picture = metadata.common.picture?.[0];
            if (!picture) return res.status(404).json({ error: 'No embedded cover' });

            res.set('Content-Type', picture.format);
            res.end(picture.data); // Use res.end() to send raw binary Buffer, not res.send()
        } catch (err) {
            console.error(`[Music] Cover error:`, err.message);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Force rescan
    router.post('/scan', async (req, res) => {
        lastScan = 0;
        library = [];
        const lib = await scanLibrary();
        res.json({ success: true, total: lib.length });
    });

    return router;
};
