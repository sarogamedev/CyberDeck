const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Persistent store for long-lived local secrets (mesh pre-shared key, file-ID
 * HMAC key). Secrets that were previously generated per process caused two
 * problems: file IDs stopped resolving after any restart, and there was no way
 * to have a stable identity to pair peers against.
 *
 * Lives next to users.json so it follows CYBERDECK_DATA_HOME when set.
 */
const STATE_DIR = process.env.CYBERDECK_DATA_HOME || path.join(__dirname, '..');
const SECRETS_FILE = path.join(STATE_DIR, 'secrets.json');

/** Read the secrets file fresh. Never cached: see getSecret. */
function readFromDisk() {
    try {
        if (fs.existsSync(SECRETS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8'));
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (err) {
        console.error('[secrets] Could not read secrets file:', err.message);
    }
    return {};
}

/**
 * Merge one secret into the file on disk and write it back atomically.
 *
 * Re-reading immediately before writing matters: secrets are created lazily on
 * first use, so one process can write meshKey while another holds a copy of the
 * file that predates it. Writing a cached snapshot would drop the other
 * process's secret and silently re-key every paired peer.
 */
function persistSecret(name, hexValue) {
    const onDisk = readFromDisk();
    onDisk[name] = hexValue;

    const tmp = `${SECRETS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SECRETS_FILE);
    try {
        fs.chmodSync(SECRETS_FILE, 0o600);
    } catch (err) {
        // Windows and some Android filesystems do not support chmod; not fatal.
    }
    return onDisk;
}

/**
 * Return the named secret as a Buffer, creating it on first use.
 * @param {string} name  Key under which the secret is stored.
 * @param {number} bytes Length to generate if absent.
 */
// Secrets are read on every mesh-authenticated request, so hits are cached.
// A miss always falls through to a fresh disk read before generating anything.
const cache = new Map();

function getSecret(name, bytes = 32) {
    const cached = cache.get(name);
    if (cached) return cached;

    // Consult the file rather than assuming absence: a secret another process
    // created after we started must be picked up, not overwritten with a new
    // one, which would silently re-key every paired peer.
    const secrets = readFromDisk();
    if (typeof secrets[name] === 'string' && secrets[name].length > 0) {
        const buf = Buffer.from(secrets[name], 'hex');
        cache.set(name, buf);
        return buf;
    }

    const value = crypto.randomBytes(bytes);
    persistSecret(name, value.toString('hex'));
    cache.set(name, value);
    return value;
}

/** Replace a secret with a freshly generated one and return it. */
function rotateSecret(name, bytes = 32) {
    const value = crypto.randomBytes(bytes);
    persistSecret(name, value.toString('hex'));
    cache.set(name, value);
    return value;
}

/** Overwrite a secret with a caller-supplied value (used when pairing nodes). */
function setSecret(name, value) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'hex');
    if (buf.length < 16) throw new Error('Secret must be at least 16 bytes');
    persistSecret(name, buf.toString('hex'));
    cache.set(name, buf);
    return buf;
}

module.exports = { getSecret, rotateSecret, setSecret, SECRETS_FILE };
