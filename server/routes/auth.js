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

        const user = auth.getUser(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!auth.verifyPassword(password, user.salt, user.passwordHash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = auth.createSession(username, user.role);
        res.json({
            success: true,
            token,
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
        if (password.length < 4) {
            return res.status(400).json({ error: 'Password must be 4+ characters' });
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
        if (!password || password.length < 4) {
            return res.status(400).json({ error: 'Password must be 4+ characters' });
        }
        const result = auth.changePassword(req.params.username, password);
        if (result.error) return res.status(400).json(result);
        res.json(result);
    });

    return router;
};
