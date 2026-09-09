const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isWithin } = require('./safePath');

const { getSecret } = require('./secretStore');

// Persisted, so file IDs issued before a restart keep resolving. This was
// previously regenerated per process, which made every existing ID fail.
const FILE_ID_SECRET = getSecret('fileIdSecret', 32);

function encodeFileId(filePath) {
    const payload = Buffer.from(filePath).toString('base64url');
    const signature = crypto.createHmac('sha256', FILE_ID_SECRET).update(filePath).digest('base64url');
    return `${payload}.${signature}`;
}

/**
 * Recursively scan a directory for files matching given extensions
 */
function scanDirectory(dirPath, extensions = [], recursive = true, rootPath = dirPath) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory() && recursive) {
                // rootPath is threaded through so relativePath stays relative to
                // the scan root. It was previously computed against the current
                // recursion directory, so every nested file looked top-level and
                // folder grouping collapsed into one bucket.
                results.push(...scanDirectory(fullPath, extensions, recursive, rootPath));
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase().slice(1);
                if (extensions.length === 0 || extensions.includes(ext)) {
                    const stat = fs.statSync(fullPath);
                    results.push({
                        id: encodeFileId(fullPath),
                        name: entry.name,
                        relativePath: path.relative(rootPath, fullPath),
                        ext: ext,
                        size: stat.size,
                        modified: stat.mtime,
                        created: stat.birthtime
                    });
                }
            }
        }
    } catch (err) {
        console.error(`Scan error for ${dirPath}:`, err.message);
    }
    return results;
}

/**
 * Decode a base64url file ID back to a file path and ensure it stays within root directory
 */
function decodeFileId(id, rootDir) {
    if (!rootDir) throw new Error('Security Error: rootDir required for decodeFileId');
    if (!id || typeof id !== 'string') throw new Error('Invalid ID');

    const parts = id.split('.');
    if (parts.length !== 2) throw new Error('Invalid ID format');

    const payload = parts[0];
    const signature = parts[1];

    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    const expectedSig = crypto.createHmac('sha256', FILE_ID_SECRET).update(decoded).digest('base64url');

    // Constant-time compare: `!==` leaked how much of the HMAC matched.
    const sigBuf = Buffer.from(signature, 'base64url');
    const expBuf = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('Access denied: File ID signature mismatch');
    }

    // isWithin requires a real separator boundary, so root "/data/Music" no
    // longer also matches "/data/Music-private".
    const resolvedPath = path.resolve(decoded);
    if (!isWithin(resolvedPath, rootDir)) {
        throw new Error('Access denied: Path outside root directory');
    }
    return resolvedPath;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get MIME type from extension
 */
function getMimeType(ext) {
    const mimeTypes = {
        // Audio
        'flac': 'audio/flac', 'mp3': 'audio/mpeg', 'ogg': 'audio/ogg',
        'wav': 'audio/wav', 'aac': 'audio/aac', 'm4a': 'audio/mp4',
        // Video
        'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'webm': 'video/webm',
        'avi': 'video/x-msvideo', 'mov': 'video/quicktime',
        // Images
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
        // Documents
        'pdf': 'application/pdf', 'epub': 'application/epub+zip',
        'txt': 'text/plain', 'html': 'text/html', 'css': 'text/css',
        'js': 'application/javascript', 'json': 'application/json',
        // Archives
        'zip': 'application/zip', 'tar': 'application/x-tar',
        'gz': 'application/gzip'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = { scanDirectory, encodeFileId, decodeFileId, formatBytes, getMimeType };
