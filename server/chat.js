const WebSocket = require('ws');

module.exports = function setupChat(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/chat' });
    const clients = new Map();
    const messageHistory = []; // Keep last 100 messages
    const MAX_HISTORY = 100;

    wss.on('connection', (ws) => {
        let username = 'Anonymous';

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);

                switch (msg.type) {
                    case 'join':
                        username = msg.username || 'Anonymous';
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
                        // Simply relay the signal to everyone (or specific target if msg.target exists)
                        // In a production app you'd route directly to msg.target, but broadcasting 
                        // on a small LAN is sufficient and the target client will filter it.
                        broadcast({
                            type: msg.type,
                            from: username,
                            target: msg.target, // The intended recipient
                            fileName: msg.fileName,
                            fileSize: msg.fileSize,
                            sdp: msg.sdp,
                            candidate: msg.candidate
                        });
                        break;

                    // DTN Engine: Background Auto-Sync Relay
                    // Bypasses Android mDNS blockage by routing epidemic sync over established Websockets
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
            clients.delete(ws);
            broadcast({
                type: 'system',
                text: `${username} left the chat`,
                timestamp: Date.now()
            });
            broadcastUserList();
        });
    });

    function broadcast(msg) {
        const data = JSON.stringify(msg);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
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
