const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'users.json');
const SESSIONS = new Map(); // In-memory session store
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Password Hashing ──

function hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
    const { hash } = hashPassword(password, salt);
    return hash === storedHash;
}

// ── User Database ──

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        // Create default admin user: admin / cyberdeck
        const { salt, hash } = hashPassword('cyberdeck');
        const defaultUsers = {
            admin: {
                username: 'admin',
                passwordHash: hash,
                salt: salt,
                role: 'admin',
                createdAt: new Date().toISOString()
            }
        };
        fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        return defaultUsers;
    }
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getUser(username) {
    const users = loadUsers();
    return users[username] || null;
}

function createUser(username, password, role = 'user') {
    const users = loadUsers();
    if (users[username]) return { error: 'User already exists' };

    const { salt, hash } = hashPassword(password);
    users[username] = {
        username,
        passwordHash: hash,
        salt,
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
    const { salt, hash } = hashPassword(newPassword);
    users[username].passwordHash = hash;
    users[username].salt = salt;
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
}

// ── Middleware ──

/** Require any authenticated user */
function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const session = getSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.user = session;
    next();
}

/** Require admin role */
function requireAdmin(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const session = getSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (session.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = session;
    next();
}

module.exports = {
    hashPassword, verifyPassword,
    loadUsers, getUser, createUser, deleteUser, listUsers, changePassword,
    createSession, getSession, destroySession,
    requireAuth, requireAdmin
};
