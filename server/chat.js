const WebSocket = require('ws');
const { getSession } = require('./utils/auth');

// Shared across every listener this process attaches chat to. setupChat used to
// be called once for HTTP and once for HTTPS, giving each its own client map
// and history, so the two sets of users could not see each other.
const clients = new Map();
const messageHistory = [];

module.exports = function setupChat(server) {
    const wss = new WebSocket.Server({
        server,
        path: '/ws/chat',
        maxPayload: 256 * 1024,
        // Reject cross-site WebSocket connections: browsers do not apply the
        // same-origin policy to WebSocket upgrades.
        verifyClient: (info, done) => {
            const origin = info.origin;
            if (!origin) return done(true); // Non-browser client (native app).
            try {
                const host = new URL(origin).host;
                const expected = info.req.headers.host;
                return done(host === expected);
            } catch (err) {
                return done(false);
            }
        }
    });
    const MAX_HISTORY = 100; // messageHistory is module-level and shared

    wss.on('connection', (ws) => {
        let username = 'Anonymous';
        let authenticated = false;

        // Close connection if not authenticated within 10 seconds
        const authTimeout = setTimeout(() => {
            if (!authenticated) {
                ws.close(4001, 'Authentication timeout');
            }
        }, 10000);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);

                // All messages except 'join' require authentication
                if (!authenticated && msg.type !== 'join') {
                    ws.send(JSON.stringify({ type: 'error', text: 'Not authenticated. Send a join message with a valid token.' }));
                    return;
                }

                if (typeof msg.text === 'string' && msg.text.length > 4000) {
                    ws.send(JSON.stringify({ type: 'error', text: 'Message too long' }));
                    return;
                }

                switch (msg.type) {
                    case 'join':
                        // Validate auth token
                        const token = msg.token;
                        if (!token) {
                            ws.send(JSON.stringify({ type: 'error', text: 'Authentication token required' }));
                            ws.close(4002, 'No auth token');
                            return;
                        }
                        const session = getSession(token);
                        if (!session) {
                            ws.send(JSON.stringify({ type: 'error', text: 'Invalid or expired token' }));
                            ws.close(4003, 'Invalid token');
                            return;
                        }

                        authenticated = true;
                        clearTimeout(authTimeout);
                        username = session.username || msg.username || 'Anonymous';
                        clients.set(ws, username);
                        // Send history to new user
                        ws.send(JSON.stringify({
                            type: 'history',
                            messages: messageHistory
                        }));
                        // Announce join
                        broadcast({
                            type: 'system',
                            text: `${username} joined the chat`,
                            timestamp: Date.now()
                        });
                        // Send user list update
                        broadcastUserList();
                        break;

                    case 'message':
                        const chatMsg = {
                            type: 'message',
                            username: username,
                            text: msg.text,
                            timestamp: Date.now()
                        };
                        messageHistory.push(chatMsg);
                        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
                        broadcast(chatMsg);
                        break;

                    case 'emergency':
                        const alert = {
                            type: 'emergency',
                            username: username,
                            text: msg.text || '🚨 EMERGENCY ALERT',
                            timestamp: Date.now()
                        };
                        broadcast(alert);
                        break;

                    // WebRTC P2P Signaling Relay
                    case 'webrtc-offer':
                    case 'webrtc-answer':
                    case 'webrtc-ice':
                    case 'webrtc-decline':
                        broadcast({
                            type: msg.type,
                            from: username,
                            target: msg.target,
                            fileName: msg.fileName,
                            fileSize: msg.fileSize,
                            sdp: msg.sdp,
                            candidate: msg.candidate
                        });
                        break;

                    // DTN Engine: Background Auto-Sync Relay
                    case 'dtn-sync':
                        broadcast({
                            type: 'dtn-sync',
                            from: msg.from,
                            dtnPayload: msg.dtnPayload
                        });
                        break;
                }
            } catch (err) {
                console.error('Chat error:', err.message);
            }
        });

        ws.on('close', () => {
            clearTimeout(authTimeout);
            if (authenticated) {
                clients.delete(ws);
                broadcast({
                    type: 'system',
                    text: `${username} left the chat`,
                    timestamp: Date.now()
                });
                broadcastUserList();
            }
        });
    });

    function broadcast(msg) {
        const data = JSON.stringify(msg);
        // Iterate the authenticated client map, not wss.clients. Broadcasting
        // to every socket meant an unauthenticated peer received all chat,
        // emergency alerts and WebRTC signalling during its grace window.
        for (const client of clients.keys()) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }

    function broadcastUserList() {
        const users = Array.from(clients.values());
        broadcast({
            type: 'users',
            users,
            count: users.length
        });
    }

    return wss;
};
