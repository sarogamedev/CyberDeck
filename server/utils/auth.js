const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getSecret } = require('./secretStore');

const STATE_DIR = process.env.CYBERDECK_DATA_HOME || path.join(__dirname, '..');
const USERS_FILE = path.join(STATE_DIR, 'users.json');
const SESSIONS = new Map(); // In-memory session store
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Login Rate Limiting ──
const LOGIN_ATTEMPTS = new Map(); // IP -> { count, firstAttempt }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
    const now = Date.now();
    const record = LOGIN_ATTEMPTS.get(ip);
    if (!record || (now - record.firstAttempt > LOGIN_WINDOW_MS)) {
        return true; // Allow
    }
    return record.count < MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(ip) {
    const now = Date.now();
    const record = LOGIN_ATTEMPTS.get(ip);
    if (!record || (now - record.firstAttempt > LOGIN_WINDOW_MS)) {
        LOGIN_ATTEMPTS.set(ip, { count: 1, firstAttempt: now });
    } else {
        record.count++;
    }
}

function clearFailedLogins(ip) {
    LOGIN_ATTEMPTS.delete(ip);
}

// Periodic cleanup of stale rate limit entries
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of LOGIN_ATTEMPTS.entries()) {
        if (now - record.firstAttempt > LOGIN_WINDOW_MS) LOGIN_ATTEMPTS.delete(ip);
    }
}, 60000).unref();

// ── Password Hashing ──

// Current cost. Existing users keep the iteration count recorded on their
// record and are transparently upgraded the next time they log in.
const PBKDF2_ITERATIONS = 210000;
const LEGACY_ITERATIONS = 10000;

function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return { salt, hash, iterations };
}

/**
 * Constant-time password check. The previous `hash === storedHash` leaked
 * timing information about how many leading bytes matched.
 */
function verifyPassword(password, salt, storedHash, iterations = LEGACY_ITERATIONS) {
    const { hash } = hashPassword(password, salt, iterations);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(String(storedHash || ''), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Verify against a user record and upgrade the stored hash if it still uses the
 * old iteration count.
 */
function verifyUser(user, password) {
    if (!user) return false;
    const iterations = Number(user.iterations) || LEGACY_ITERATIONS;
    if (!verifyPassword(password, user.salt, user.passwordHash, iterations)) return false;

    if (iterations < PBKDF2_ITERATIONS) {
        try {
            const users = loadUsers();
            if (users[user.username]) {
                const upgraded = hashPassword(password, null, PBKDF2_ITERATIONS);
                users[user.username].passwordHash = upgraded.hash;
                users[user.username].salt = upgraded.salt;
                users[user.username].iterations = upgraded.iterations;
                saveUsers(users);
            }
        } catch (err) {
            console.error('[auth] Could not upgrade password hash:', err.message);
        }
    }
    return true;
}

// ── User Database ──

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        // Create default admin user: admin / cyberdeck
        const { salt, hash, iterations } = hashPassword('cyberdeck');
        const defaultUsers = {
            admin: {
                username: 'admin',
                passwordHash: hash,
                salt: salt,
                iterations,
                role: 'admin',
                // Seeded credentials are identical on every install, so the
                // account is unusable for anything but changing its password.
                mustChangePassword: true,
                createdAt: new Date().toISOString()
            }
        };
        fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        return defaultUsers;
    }
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
    // Write via a temp file and rename, so a crash mid-write cannot truncate
    // the entire user database.
    const tmp = `${USERS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, USERS_FILE);
}

function getUser(username) {
    const users = loadUsers();
    return users[username] || null;
}

function createUser(username, password, role = 'user') {
    const users = loadUsers();
    if (users[username]) return { error: 'User already exists' };

    const { salt, hash, iterations } = hashPassword(password);
    users[username] = {
        username,
        passwordHash: hash,
        salt,
        iterations,
        role,
        createdAt: new Date().toISOString()
    };
    saveUsers(users);
    return { success: true, username, role };
}

function deleteUser(username) {
    const users = loadUsers();
    if (!users[username]) return { error: 'User not found' };
    if (username === 'admin') return { error: 'Cannot delete the default admin' };
    delete users[username];
    saveUsers(users);
    return { success: true };
}

function listUsers() {
    const users = loadUsers();
    return Object.values(users).map(u => ({
        username: u.username,
        role: u.role,
        createdAt: u.createdAt
    }));
}

function changePassword(username, newPassword) {
    const users = loadUsers();
    if (!users[username]) return { error: 'User not found' };
    const { salt, hash, iterations } = hashPassword(newPassword);
    users[username].passwordHash = hash;
    users[username].salt = salt;
    users[username].iterations = iterations;
    delete users[username].mustChangePassword;
    saveUsers(users);
    return { success: true };
}

// ── Sessions ──

function createSession(username, role) {
    const token = crypto.randomBytes(32).toString('hex');
    SESSIONS.set(token, {
        username,
        role,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL
    });
    return token;
}

function getSession(token) {
    const session = SESSIONS.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        SESSIONS.delete(token);
        return null;
    }
    return session;
}

function destroySession(token) {
    SESSIONS.delete(token);
    for (const [mt, rec] of MEDIA_TOKENS) {
        if (rec.session === token) MEDIA_TOKENS.delete(mt);
    }
}

// ── Media tokens ──
//
// <img>, <audio>, <video> and <iframe> cannot send headers, so media URLs used
// to carry the full session token in the query string, where it landed in
// access logs, browser history and Referer headers. These replacements are
// short-lived, read-only, and usable on GET requests to media routes only.

const MEDIA_TOKENS = new Map();
const MEDIA_TOKEN_TTL = 60 * 60 * 1000; // 1 hour

function createMediaToken(session, sessionToken) {
    const token = crypto.randomBytes(32).toString('hex');
    MEDIA_TOKENS.set(token, {
        username: session.username,
        role: session.role,
        session: sessionToken,
        expiresAt: Date.now() + MEDIA_TOKEN_TTL
    });
    return { token, expiresIn: MEDIA_TOKEN_TTL };
}

function getMediaToken(token) {
    const rec = MEDIA_TOKENS.get(token);
    if (!rec) return null;
    if (Date.now() > rec.expiresAt) {
        MEDIA_TOKENS.delete(token);
        return null;
    }
    // A media token dies with the session that issued it.
    if (!SESSIONS.has(rec.session)) {
        MEDIA_TOKENS.delete(token);
        return null;
    }
    return rec;
}

setInterval(() => {
    const now = Date.now();
    for (const [token, rec] of MEDIA_TOKENS) {
        if (now > rec.expiresAt) MEDIA_TOKENS.delete(token);
    }
}, 5 * 60 * 1000).unref();

// ── Middleware ──

/**
 * Resolve the caller's session from the header. Query-string tokens are no
 * longer accepted here; see requireMediaAuth for the media-element case.
 */
function resolveSession(req) {
    const token = req.headers['x-auth-token'];
    if (!token) return { error: 'Authentication required', status: 401 };
    const session = getSession(token);
    if (!session) return { error: 'Invalid or expired session', status: 401 };

    // An account still on its seeded password may only change that password.
    const user = getUser(session.username);
    if (user && user.mustChangePassword) {
        return {
            error: 'Password change required before using this account',
            status: 403,
            code: 'password_change_required'
        };
    }
    return { session, token };
}

/** Require any authenticated user */
function requireAuth(req, res, next) {
    const result = resolveSession(req);
    if (result.error) {
        return res.status(result.status).json({ error: result.error, code: result.code });
    }
    req.user = result.session;
    req.sessionToken = result.token;
    next();
}

/** Require admin role */
function requireAdmin(req, res, next) {
    const result = resolveSession(req);
    if (result.error) {
        return res.status(result.status).json({ error: result.error, code: result.code });
    }
    if (result.session.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = result.session;
    req.sessionToken = result.token;
    next();
}

/**
 * For routes that media elements load directly. Accepts a normal session header
 * or, on GET only, a short-lived media token in the query string.
 */
function requireMediaAuth(req, res, next) {
    if (req.headers['x-auth-token']) return requireAuth(req, res, next);

    if (req.method === 'GET' && typeof req.query.token === 'string') {
        const rec = getMediaToken(req.query.token);
        if (rec) {
            req.user = { username: rec.username, role: rec.role };
            return next();
        }
    }
    return res.status(401).json({ error: 'Authentication required' });
}

module.exports = {
    hashPassword, verifyPassword, verifyUser,
    createMediaToken, getMediaToken,
    requireMediaAuth,
    loadUsers, getUser, createUser, deleteUser, listUsers, changePassword,
    createSession, getSession, destroySession,
    requireAuth, requireAdmin,
    checkRateLimit, recordFailedLogin, clearFailedLogins
};
