const crypto = require('crypto');
const { getSecret, rotateSecret, setSecret } = require('./secretStore');

/**
 * Mesh peer authentication.
 *
 * The DTN sync and LAN content-sync endpoints used to be fully unauthenticated
 * so that nodes could find each other with zero configuration. That also meant
 * any host on the same network could read the entire message spool, forge
 * packets into it, and pull files off the box.
 *
 * Nodes now share a pre-shared key, exchanged out of band (QR code or manual
 * entry in the admin panel). Every peer request carries an HMAC over the
 * timestamp, method, path and body, so a request cannot be replayed against a
 * different route or altered in flight.
 */

const MESH_KEY_NAME = 'meshKey';
const HEADER = 'x-mesh-auth';
const SKEW_MS = 5 * 60 * 1000; // Accept timestamps within five minutes.

// Signatures already accepted, so a captured request cannot be replayed inside
// the skew window. Bounded by the window itself.
const seen = new Map();

function getMeshKey() {
    return getSecret(MESH_KEY_NAME, 32);
}

function rotateMeshKey() {
    seen.clear();
    return rotateSecret(MESH_KEY_NAME, 32);
}

function setMeshKey(hexKey) {
    if (typeof hexKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hexKey.trim())) {
        throw new Error('Mesh key must be 64 hex characters');
    }
    seen.clear();
    return setSecret(MESH_KEY_NAME, hexKey.trim().toLowerCase());
}

/** Canonical string that both sides sign. Body is hashed, not embedded. */
function canonicalString(timestamp, nonce, method, urlPath, bodyBuffer) {
    const bodyHash = crypto.createHash('sha256')
        .update(bodyBuffer && bodyBuffer.length ? bodyBuffer : Buffer.alloc(0))
        .digest('hex');
    return `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${urlPath}\n${bodyHash}`;
}

/**
 * Build the header value for an outbound request to a peer.
 * @param {string} method   HTTP method.
 * @param {string} urlPath  Path only, including query string, no origin.
 * @param {string|Buffer} body Request body as it will be sent ('' for GET).
 */
function signRequest(method, urlPath, body = '') {
    const timestamp = Date.now();
    // A random nonce, so two identical requests in the same millisecond do not
    // produce the same signature and trip the replay cache.
    const nonce = crypto.randomBytes(12).toString('hex');
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '', 'utf8');
    const mac = crypto.createHmac('sha256', getMeshKey())
        .update(canonicalString(timestamp, nonce, method, urlPath, bodyBuffer))
        .digest('hex');
    return `${timestamp}.${nonce}.${mac}`;
}

/** Convenience: headers object for node-fetch calls to a peer. */
function signedHeaders(method, urlPath, body = '', extra = {}) {
    return { ...extra, [HEADER]: signRequest(method, urlPath, body) };
}

function pruneSeen(now) {
    for (const [sig, ts] of seen) {
        if (now - ts > SKEW_MS) seen.delete(sig);
    }
}

/**
 * Express middleware guarding peer-to-peer endpoints.
 *
 * Requires `express.json({ verify })` to have stashed the raw body on
 * `req.rawBody`, so the signature covers exactly the bytes we received.
 */
function requireMeshPeer(req, res, next) {
    const header = req.headers[HEADER];
    if (typeof header !== 'string' || !header.includes('.')) {
        return res.status(401).json({ error: 'Mesh authentication required' });
    }

    const parts = header.split('.');
    if (parts.length !== 3) {
        return res.status(401).json({ error: 'Malformed mesh signature' });
    }
    const timestamp = Number(parts[0]);
    const nonce = parts[1];
    const provided = parts[2];

    if (!Number.isFinite(timestamp) ||
        !/^[0-9a-f]{24}$/.test(nonce) ||
        !/^[0-9a-f]{64}$/.test(provided)) {
        return res.status(401).json({ error: 'Malformed mesh signature' });
    }

    const now = Date.now();
    if (Math.abs(now - timestamp) > SKEW_MS) {
        return res.status(401).json({ error: 'Mesh signature expired' });
    }

    // The signature covers originalUrl, which is the path the client actually
    // requested, before any internal rewriting in server.js.
    const urlPath = req.originalUrl || req.url;
    const expected = crypto.createHmac('sha256', getMeshKey())
        .update(canonicalString(timestamp, nonce, req.method, urlPath, req.rawBody))
        .digest('hex');

    const providedBuf = Buffer.from(provided, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (providedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        return res.status(401).json({ error: 'Invalid mesh signature' });
    }

    pruneSeen(now);
    if (seen.has(provided)) {
        return res.status(401).json({ error: 'Replayed mesh request' });
    }
    seen.set(provided, now);

    req.meshPeer = { ip: req.ip, at: timestamp };
    next();
}

module.exports = {
    HEADER,
    getMeshKey,
    rotateMeshKey,
    setMeshKey,
    signRequest,
    signedHeaders,
    requireMeshPeer
};
