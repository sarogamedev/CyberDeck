// ═══════════════════════════════════════════
// CyberDeck - Delay-Tolerant Networking (DTN)
// ═══════════════════════════════════════════

const DtnModule = {
    packets: [],

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async init() {
        const el = document.getElementById('mod-dtn');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">DTN Engine</div>
                    <div class="module-subtitle">Store-and-Forward delay-tolerant routing</div>
                </div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="btn" style="background:var(--surface2);" onclick="DtnModule.refresh()">🔄 Refresh Spool</button>
                    <button class="btn btn-primary" onclick="DtnModule.showNewMessageUI()">+ Inject Packet</button>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 20px;">
                
                <div class="card" id="dtn-composer" style="display: none; border-color: var(--cyan); box-shadow: var(--glow-cyan);">
                    <h3 style="color:var(--cyan);margin-bottom:15px">Inject New Packet</h3>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <input type="text" id="dtn-sender" placeholder="Your Alias (Sender)" class="search-box" style="padding: 10px; width: 100%; box-sizing: border-box; color: #fff;">
                        <input type="text" id="dtn-dest" placeholder="Destination (default: ALL)" value="ALL" class="search-box" style="padding: 10px; width: 100%; box-sizing: border-box; color: #fff;">
                        <textarea id="dtn-payload" placeholder="Enter message payload..." class="search-box" style="padding: 10px; width: 100%; min-height: 80px; box-sizing: border-box; resize: vertical; color: #fff; font-family: monospace;"></textarea>
                        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                            <span style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">TTL (Hours):</span>
                            <input type="number" id="dtn-ttl" value="48" min="1" max="168" class="search-box" style="padding: 5px 10px; width: 80px; color: #fff;">
                            <div style="flex: 1; min-width: 10px;"></div>
                            <button class="btn" style="background:var(--surface2);" onclick="document.getElementById('dtn-composer').style.display='none'">Cancel</button>
                            <button class="btn btn-primary" onclick="DtnModule.sendPacket()">Inject to Network</button>
                        </div>
                    </div>
                </div>

                <div class="card" id="dtn-manual-sync">
                    <h3 style="margin-bottom:10px">Manual Peer Sync (Air-Gap Bridge)</h3>
                    <p style="color: var(--text-dim); font-size: 12px; margin-bottom: 15px;">
                        CyberDeck automatically discovers nearby nodes using mDNS. If mDNS is blocked by a router or Android Hotspot, manually bridge the gap by entering the peer's IP here.
                    </p>
                    <div class="search-box" style="display: flex; padding-right: 4px;">
                        <input type="text" id="dtn-peer-ip" placeholder="e.g. 192.168.43.1" style="flex: 1; color: #fff;">
                        <button class="btn btn-primary" onclick="DtnModule.manualSync()">Force Sync</button>
                    </div>
                </div>

                <div class="card">
                    <h3 style="margin-bottom:15px">Local Routing Spool <span id="dtn-spool-count" class="tag tag-cyan">0 Packets</span></h3>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px;">
                            <thead>
                                <tr style="border-bottom: 2px solid var(--border); color: var(--text-dim);">
                                    <th style="padding: 10px;">ID Hash</th>
                                    <th style="padding: 10px;">Type</th>
                                    <th style="padding: 10px;">Sender → Dest</th>
                                    <th style="padding: 10px;">Payload Preview</th>
                                    <th style="padding: 10px;">Expires In</th>
                                </tr>
                            </thead>
                            <tbody id="dtn-spool-table">
                                <tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-dim);">Loading spool...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;
        await this.refresh();
    },

    showNewMessageUI() {
        document.getElementById('dtn-composer').style.display = 'block';
    },

    async sendPacket() {
        const sender = document.getElementById('dtn-sender').value || 'anonymous';
        const dest = document.getElementById('dtn-dest').value || 'ALL';
        const payload = document.getElementById('dtn-payload').value;
        const ttl = parseInt(document.getElementById('dtn-ttl').value) || 48;

        if (!payload) return alert('Payload is required');

        try {
            const res = await authFetch(`${API}/api/dtn/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender, dest, payload, ttl_hours: ttl })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('dtn-composer').style.display = 'none';
                document.getElementById('dtn-payload').value = '';

                // Instantly blast the target packet out over the Chat Relay if connected
                if (window.ChatModule && window.ChatModule.ws && window.ChatModule.ws.readyState === 1 /* OPEN */) {
                    window.ChatModule.ws.send(JSON.stringify({
                        type: 'dtn-sync',
                        from: Auth.user?.username || 'Anonymous',
                        dtnPayload: [data.packet]
                    }));
                }

                this.refresh();
            } else {
                alert('Failed to inject packet');
            }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    },

    async manualSync() {
        const ip = document.getElementById('dtn-peer-ip').value;
        if (!ip) return alert('Enter a peer IP');

        try {
            // Instead of making the client browser fetch Cross-Origin (which gets blocked by CORS and HTTPS Mixed Content),
            // tell our local Node.js server to do the fetching for us.
            const res = await authFetch(`${API}/api/dtn/manual_sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetIp: ip })
            });
            const data = await res.json();

            if (data.success) {
                alert(data.message || 'Sync successful!');
            } else {
                alert('Sync failed: ' + (data.error || 'Unknown error'));
            }

            this.refresh();
        } catch (e) {
            alert('Manual sync failed. Ensure IP is reachable and running CyberDeck. Error: ' + e.message);
        }
    },

    async refresh() {
        try {
            const res = await authFetch(`${API}/api/dtn/packets`);
            const data = await res.json();
            this.packets = data.packets || [];

            document.getElementById('dtn-spool-count').textContent = `${this.packets.length} Packets`;

            const tbody = document.getElementById('dtn-spool-table');

            if (this.packets.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-dim);">Spool is empty. Waiting for packets...</td></tr>';
                return;
            }

            // Sort by newest first
            this.packets.sort((a, b) => b.timestamp - a.timestamp);

            let html = '';
            for (const p of this.packets) {
                const typeClr = p.type === 'sos' ? 'var(--red)' : (p.type === 'map_update' ? 'var(--green)' : 'var(--cyan)');
                const hoursLeft = Math.max(0, Math.floor((p.ttl_expiry - Date.now()) / (1000 * 60 * 60)));
                const shortId = p.id.substring(0, 8) + '...';
                const payloadPreview = p.payload.length > 40 ? p.payload.substring(0, 40) + '...' : p.payload;

                html += `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 10px; font-family: monospace; color: var(--text-dim);">${shortId}</td>
                        <td style="padding: 10px;"><span class="tag" style="color: ${typeClr}; border-color: ${typeClr}; background: transparent;">${p.type.toUpperCase()}</span></td>
                        <td style="padding: 10px;"><strong style="color:#fff">${this.escapeHtml(p.sender)}</strong> → <span style="color:var(--text-dim)">${this.escapeHtml(p.dest)}</span></td>
                        <td style="padding: 10px;">${this.escapeHtml(payloadPreview)}</td>
                        <td style="padding: 10px; font-family: monospace; ${hoursLeft < 2 ? 'color: var(--red);' : 'color: var(--text-dim);'}">${hoursLeft}h</td>
                    </tr>
                `;
            }
            tbody.innerHTML = html;
        } catch (e) {
            document.getElementById('dtn-spool-table').innerHTML = `<tr><td colspan="5" style="color:red; padding:10px;">Failed to load spool: ${e.message}</td></tr>`;
        }
    }
};
