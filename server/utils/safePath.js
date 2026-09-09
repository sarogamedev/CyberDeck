const path = require('path');

/**
 * Resolve one or more untrusted path segments against a trusted root and
 * guarantee the result stays inside that root.
 *
 * The naive `resolved.startsWith(root)` check used previously matched sibling
 * directories too: root "/data/Music" also "contained" "/data/Music-private".
 * We require either an exact match or a real separator boundary.
 *
 * @param {string} root       Trusted base directory.
 * @param  {...string} segments Untrusted segments (params, filenames, ids).
 * @returns {string} Absolute path guaranteed to be within root.
 * @throws {Error} If the segments escape root or contain a NUL byte.
 */
function resolveWithin(root, ...segments) {
    if (!root) throw new Error('resolveWithin: root is required');

    for (const seg of segments) {
        if (typeof seg !== 'string') {
            throw new Error('Access denied: path segment must be a string');
        }
        if (seg.indexOf('\0') !== -1) {
            throw new Error('Access denied: path segment contains a null byte');
        }
    }

    const normalizedRoot = path.resolve(root);
    const resolved = path.resolve(normalizedRoot, ...segments);

    if (!isWithin(resolved, normalizedRoot)) {
        throw new Error('Access denied: path outside root directory');
    }
    return resolved;
}

/**
 * True when `target` is `root` itself or a descendant of it.
 * Comparison is case-insensitive on Windows, where the filesystem is.
 */
function isWithin(target, root) {
    let resolved = path.resolve(target);
    let normalizedRoot = path.resolve(root);

    if (process.platform === 'win32') {
        resolved = resolved.toLowerCase();
        normalizedRoot = normalizedRoot.toLowerCase();
    }

    if (resolved === normalizedRoot) return true;
    return resolved.startsWith(normalizedRoot.endsWith(path.sep)
        ? normalizedRoot
        : normalizedRoot + path.sep);
}

/**
 * Reject any string that is not a single, plain path component.
 * Blocks traversal, absolute paths, separators and Windows drive prefixes.
 */
function isSafeComponent(name) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false;
    if (name === '.' || name === '..') return false;
    if (name.indexOf('\0') !== -1) return false;
    if (name.includes('/') || name.includes('\\')) return false;
    if (/^[a-zA-Z]:/.test(name)) return false;
    return true;
}

module.exports = { resolveWithin, isWithin, isSafeComponent };
