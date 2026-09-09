const express = require('express');
const auth = require('../utils/auth');

module.exports = function (config) {
    const router = express.Router();

    // Login
    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Rate limiting check
        const clientIp = req.ip || req.connection.remoteAddress;
        if (!auth.checkRateLimit(clientIp)) {
            return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
        }

        const user = auth.getUser(username);
        if (!user) {
            auth.recordFailedLogin(clientIp);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // verifyUser is constant-time and upgrades legacy hashes on success.
        if (!auth.verifyUser(user, password)) {
            auth.recordFailedLogin(clientIp);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        auth.clearFailedLogins(clientIp);

        const token = auth.createSession(username, user.role);
        res.json({
            success: true,
            token,
            mustChangePassword: !!user.mustChangePassword,
            user: { username: user.username, role: user.role }
        });
    });

    // Logout
    router.post('/logout', (req, res) => {
        const token = req.headers['x-auth-token'];
        if (token) auth.destroySession(token);
        res.json({ success: true });
    });

    // Check session validity
    router.get('/me', auth.requireAuth, (req, res) => {
        res.json({
            username: req.user.username,
            role: req.user.role
        });
    });

    // Short-lived, read-only token for <img>/<audio>/<video>/<iframe> URLs,
    // which cannot send an auth header. Replaces putting the session token in
    // the query string.
    router.post('/media-token', auth.requireAuth, (req, res) => {
        res.json(auth.createMediaToken(req.user, req.sessionToken));
    });

    // Change your own password. Deliberately reachable while the account is
    // flagged mustChangePassword, which blocks every other authenticated route.
    router.post('/change-password', (req, res) => {
        const token = req.headers['x-auth-token'];
        const session = token ? auth.getSession(token) : null;
        if (!session) return res.status(401).json({ error: 'Authentication required' });

        const { currentPassword, newPassword } = req.body || {};
        const user = auth.getUser(session.username);
        if (!user || !auth.verifyUser(user, currentPassword || '')) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be 8+ characters' });
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({ error: 'New password must differ from the current one' });
        }

        const result = auth.changePassword(session.username, newPassword);
        if (result.error) return res.status(400).json(result);
        res.json({ success: true });
    });

    // ── Admin-only: User Management ──

    // List all users
    router.get('/users', auth.requireAdmin, (req, res) => {
        res.json(auth.listUsers());
    });

    // Create user
    router.post('/users', auth.requireAdmin, (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be 3+ characters' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be 8+ characters' });
        }
        const validRoles = ['user', 'admin'];
        const userRole = validRoles.includes(role) ? role : 'user';
        const result = auth.createUser(username, password, userRole);
        if (result.error) return res.status(400).json(result);
        res.json(result);
    });

    // Delete user
    router.delete('/users/:username', auth.requireAdmin, (req, res) => {
        const result = auth.deleteUser(req.params.username);
        if (result.error) return res.status(400).json(result);
        res.json(result);
    });

    // Change user password
    router.put('/users/:username/password', auth.requireAdmin, (req, res) => {
        const { password } = req.body;
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be 8+ characters' });
        }
        const result = auth.changePassword(req.params.username, password);
        if (result.error) return res.status(400).json(result);
        res.json(result);
    });

    return router;
};
