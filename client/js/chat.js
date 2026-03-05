// ═══════════════════════════════════════════
// CyberDeck - LAN Chat (WebSocket)
// ═══════════════════════════════════════════

const ChatModule = {
    ws: null,
    messages: [],
    users: [],
    sessionId: Math.random().toString(36).substring(2, 15),

    init() {
        const el = document.getElementById('mod-chat');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">LAN Chat</div>
                    <div class="module-subtitle" id="chatStatus">Connecting...</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                    <span id="chatUserCount" class="tag tag-cyan">0 online</span>
                    <button class="btn" style="background:var(--red);border-color:var(--red);color:white" onclick="ChatModule.sendEmergency()">🚨 SOS</button>
                </div>
            </div>
            <div class="chat-container">
                <div class="chat-messages" id="chatMessages">
                    <div class="empty-state"><div class="empty-icon">📡</div><h3>LAN Chat</h3><p>Messages are shared with all connected devices on this network</p></div>
                </div>
                <div class="chat-input-area">
                    <input type="text" class="chat-input" id="chatInput" placeholder="Type a message..."
                           onkeydown="if(event.key==='Enter') ChatModule.send()">
                    <button class="btn btn-primary" onclick="ChatModule.send()" style="padding:12px 20px">Send</button>
                </div>
            </div>
        `;
        this.connect();
    },

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/chat`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                document.getElementById('chatStatus').textContent = 'Connected to LAN';
                this.ws.send(JSON.stringify({
                    type: 'join',
                    username: Auth.user?.username || 'Anonymous'
                }));

                // DTN Over-The-Air WebSocket Bridge
                // (Bypasses Android mDNS blockage by piggybacking on the LAN Chat Relay)
                this.dtnSyncInterval = setInterval(async () => {
                    try {
                        const res = await authFetch('/api/dtn/packets');
                        const data = await res.json();
                        if (data.packets && data.packets.length > 0) {
                            this.ws.send(JSON.stringify({
                                type: 'dtn-sync',
                                from: Auth.user?.username || 'Anonymous',
                                sessionId: this.sessionId,
                                dtnPayload: data.packets
                            }));
                        }
                    } catch (e) { /* ignore */ }
                }, 10000); // Blast local spool to mesh every 10 seconds
            };

            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            };

            this.ws.onclose = () => {
                if (this.dtnSyncInterval) clearInterval(this.dtnSyncInterval);
                document.getElementById('chatStatus').textContent = 'Disconnected — reconnecting...';
                setTimeout(() => this.connect(), 3000);
            };

            this.ws.onerror = () => {
                document.getElementById('chatStatus').textContent = 'Connection error';
            };
        } catch (err) {
            document.getElementById('chatStatus').textContent = 'WebSocket not supported';
        }
    },

    handleMessage(msg) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        switch (msg.type) {
            case 'history':
                this.messages = msg.messages || [];
                container.innerHTML = '';
                this.messages.forEach(m => this.appendMsg(m));
                break;

            case 'message':
                this.messages.push(msg);
                this.appendMsg(msg);
                break;

            case 'system':
                this.appendSystem(msg.text);
                break;

            case 'emergency':
                this.appendEmergency(msg);
                break;

            case 'users':
                this.users = msg.users;
                const countEl = document.getElementById('chatUserCount');
                if (countEl) countEl.textContent = `${msg.count} online`;
                if (window.P2PModule) window.P2PModule.updateUsers(msg.users);
                break;

            case 'dtn-sync':
                // Someone sent DTN packets through the WebSocket!
                // Skip our own broadcasts
                if (msg.sessionId === this.sessionId) break;

                // Silently push them to our local spool
                if (msg.dtnPayload && msg.dtnPayload.length > 0) {
                    authFetch('/api/dtn/sync/receive', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ packets: msg.dtnPayload })
                    }).catch(e => { /* ignore silent failure */ });
                }
                // Also trigger a UI refresh if the DTN tab is open
                if (window.DtnModule && typeof window.DtnModule.refresh === 'function') {
                    window.DtnModule.refresh();
                }
                break;

            case 'webrtc-offer':
            case 'webrtc-answer':
            case 'webrtc-ice':
            case 'webrtc-decline':
                if (window.P2PModule) window.P2PModule.handleSignal(msg);
                break;
        }
    },

    appendMsg(msg) {
        const container = document.getElementById('chatMessages');
        const isMe = msg.username === (Auth.user?.username || 'Anonymous');
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const div = document.createElement('div');
        div.className = `chat-msg ${isMe ? 'user' : 'assistant'}`;
        div.innerHTML = `
            <div class="msg-avatar">${isMe ? '👤' : '🤝'}</div>
            <div>
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">${msg.username} · ${time}</div>
                <div class="msg-bubble">${this.escapeHtml(msg.text)}</div>
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    appendSystem(text) {
        const container = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.style.cssText = 'text-align:center;color:var(--text-dim);font-size:12px;padding:8px';
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    appendEmergency(msg) {
        const container = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.style.cssText = 'background:rgba(255,51,102,0.15);border:1px solid var(--red);border-radius:8px;padding:16px;margin:8px 0;text-align:center';
        div.innerHTML = `<div style="font-size:24px;margin-bottom:8px">🚨</div>
            <div style="color:var(--red);font-weight:bold;font-size:16px">EMERGENCY from ${msg.username}</div>
            <div style="margin-top:8px">${this.escapeHtml(msg.text)}</div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;

        // Play alert sound
        try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 880; gain.gain.value = 0.5;
            osc.start(); osc.stop(ctx.currentTime + 0.5);
            setTimeout(() => { const o2 = ctx.createOscillator(); const g2 = ctx.createGain(); o2.connect(g2); g2.connect(ctx.destination); o2.frequency.value = 880; g2.gain.value = 0.5; o2.start(); o2.stop(ctx.currentTime + 0.5); }, 700);
        } catch { }
    },

    send() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({ type: 'message', text }));
        input.value = '';
    },

    sendEmergency() {
        const text = prompt('Emergency message (or leave blank for SOS):') || '🚨 SOS — Emergency Alert';
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'emergency', text }));
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
