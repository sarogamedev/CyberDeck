const express = require('express');
const path = require('path');
const { parseRange, sendUnsatisfiable } = require('../utils/httpRange');
const fs = require('fs');
const { scanDirectory, decodeFileId, getMimeType } = require('../utils/scanner');

module.exports = function (config) {
    const router = express.Router();
    let library = [];
    let lastScan = 0;

    const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', '3gp'];

    async function scanVideos() {
        const now = Date.now();
        if (library.length > 0 && now - lastScan < 60000) return library;
        library = scanDirectory(config.paths.videos, VIDEO_EXTS);
        lastScan = now;
        return library;
    }

    // List all videos
    router.get('/', async (req, res) => {
        try {
            const videos = await scanVideos();
            // Group by folder
            const folders = {};
            for (const video of videos) {
                // scanDirectory emits relativePath, not path. Reading video.path
                // gave undefined and path.dirname threw, so this route returned
                // 500 for every non-empty video library.
                const dir = path.dirname(video.relativePath || '');
                const folderName = dir === '.' || dir === '' ? 'Videos' : path.basename(dir);
                if (!folders[folderName]) folders[folderName] = [];
                folders[folderName].push(video);
            }
            res.json({
                total: videos.length,
                videos,
                folders: Object.entries(folders)
                    .map(([name, items]) => ({ name, count: items.length, videos: items }))
            });
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Stream video with range support
    router.get('/stream/:id', (req, res) => {
        try {
            const filePath = decodeFileId(req.params.id, config.paths.videos);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

            const stat = fs.statSync(filePath);
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const mime = getMimeType(ext);
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
                    'Content-Type': mime,
                    'Accept-Ranges': 'bytes'
                });
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Force rescan
    router.post('/scan', async (req, res) => {
        lastScan = 0;
        library = [];
        const videos = await scanVideos();
        res.json({ success: true, total: videos.length });
    });

    return router;
};
