// ═══════════════════════════════════════════
// CyberDeck - Nearby CyberDecks (LAN Content Sync)
// ═══════════════════════════════════════════

const NearbyModule = {
    peers: [],
    selectedPeer: null,
    peerLibrary: null,
    pollTimer: null,
    selfIp: '...',

    async init() {
        const el = document.getElementById('mod-nearby');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Nearby CyberDecks</div>
                    <div class="module-subtitle">Discover and sync content with nearby nodes</div>
                </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 20px; background: var(--surface2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
                <span class="search-icon">📡</span>
                <input type="text" id="manual-peer-ip" class="input" placeholder="Enter peer IP (e.g. 192.168.1.50)..." style="flex: 1; border: none; background: transparent; color: var(--text);"
                    onkeydown="if(event.key==='Enter') NearbyModule.connectManual()">
                <button class="btn btn-primary btn-sm" onclick="NearbyModule.connectManual()">Connect</button>
            </div>
            <div id="nearby-peers" style="margin-bottom: 20px;"><div class="loading-spinner"></div></div>
            <div id="nearby-library"></div>`;

        await this.discoverPeers();

        // Auto-refresh peers every 15 seconds
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
            const page = document.getElementById('mod-nearby');
            if (page && page.classList.contains('active')) {
                this.discoverPeers(true); // silent refresh
            }
        }, 15000);
    },

    async discoverPeers(silent = false) {
        const el = document.getElementById('nearby-peers');
        if (!silent) el.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/peers`);
            const data = await res.json();
            this.peers = data.peers || [];
            if (data.self) this.selfIp = data.self;
            this.renderPeers();
        } catch (err) {
            el.innerHTML = `<div class="empty-state"><h3>Discovery Error</h3><p>${err.message}</p></div>`;
        }
    },

    renderPeers() {
        const el = document.getElementById('nearby-peers');

        let html = `
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
                <span style="font-size: 12px; color: var(--text-dim);">Your IP: <strong style="color: var(--cyan);">${this.selfIp}</strong></span>
                <button class="btn btn-sm" style="font-size:12px;" onclick="NearbyModule.discoverPeers()">🔄 Refresh</button>
            </div>`;

        if (this.peers.length === 0) {
            html += `
                <div style="background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 20px; text-align: center;">
                    <p style="font-size: 14px; margin-bottom: 8px; color: var(--text-dim);">📡 Scanning for auto-discoverable CyberDecks...</p>
                    <p style="font-size: 11px; color: var(--text-dim);">Peers appear automatically via mDNS and UDP beacons within ~10 seconds.</p>
                </div>`;
        } else {
            html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">';
            for (const peer of this.peers) {
                const isSelected = this.selectedPeer === peer.ip;
                const agoSec = Math.floor(peer.agoMs / 1000);
                const agoText = agoSec < 10 ? 'just now' : agoSec < 60 ? `${agoSec}s ago` : `${Math.floor(agoSec / 60)}m ago`;

                html += `
                    <div class="card" style="cursor: pointer; padding: 16px; border: 2px solid ${isSelected ? 'var(--cyan)' : 'var(--border)'}; transition: all 0.2s;"
                        onclick="NearbyModule.selectPeer('${peer.ip}')"
                        onmouseenter="this.style.borderColor='var(--cyan)'"
                        onmouseleave="this.style.borderColor='${isSelected ? 'var(--cyan)' : 'var(--border)'}'"
                    >
                        <div style="font-size: 24px; text-align: center; margin-bottom: 8px;">🖥️</div>
                        <div style="text-align: center;">
                            <strong style="color: var(--cyan); font-size: 14px;">${peer.ip}</strong>
                            <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Seen ${agoText}</div>
                            ${isSelected ? '<div style="font-size:11px;color:var(--green);margin-top:4px;">● Connected</div>' : ''}
                        </div>
                    </div>`;
            }
            html += '</div>';
        }

        el.innerHTML = html;
    },

    connectManual() {
        const ip = document.getElementById('manual-peer-ip')?.value?.trim();
        if (!ip) { alert('Enter an IP address'); return; }
        this.selectPeer(ip);
    },

    async selectPeer(ip) {
        this.selectedPeer = ip;
        this.peerLibrary = null;
        // Re-render peers to show selection
        try {
            const res = await authFetch(`${API}/api/peers`);
            const data = await res.json();
            this.peers = data.peers || [];
            // Add manual peer if not in list
            if (!this.peers.find(p => p.ip === ip)) {
                this.peers.push({ ip, lastSeen: Date.now(), agoMs: 0 });
            }
            if (data.self) this.selfIp = data.self;
            this.renderPeers();
        } catch (e) { }

        // Fetch library
        const libEl = document.getElementById('nearby-library');
        libEl.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/store/peer/library`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerIp: ip })
            });
            const data = await res.json();

            if (!data.success) {
                libEl.innerHTML = `<div class="empty-state"><h3>❌ Connection Failed</h3><p>${data.error || 'Could not reach peer.'}</p>
                    <p style="font-size:12px;color:var(--text-dim);">Make sure the other CyberDeck is running on port 8443.</p></div>`;
                return;
            }

            this.peerLibrary = data;
            this.renderLibrary();
        } catch (err) {
            libEl.innerHTML = `<div class="empty-state"><h3>❌ Error</h3><p>${err.message}</p></div>`;
        }
    },

    renderLibrary() {
        const el = document.getElementById('nearby-library');
        const data = this.peerLibrary;
        if (!data || !data.items) { el.innerHTML = '<div class="empty-state"><h3>No data</h3></div>'; return; }

        if (data.items.length === 0) {
            el.innerHTML = `<div class="empty-state"><h3>📭 Empty Library</h3><p>${data.node || this.selectedPeer} has no content to share.</p></div>`;
            return;
        }

        let html = `<div style="margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 14px;">🖥️ <strong style="color: var(--cyan);">${data.node || this.selectedPeer}</strong></span>
            <span class="tag tag-cyan">${data.items.length} item${data.items.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-sm" style="font-size:12px;" onclick="NearbyModule.selectPeer('${this.selectedPeer}')">🔄 Refresh</button>
        </div>`;

        html += '<div class="store-grid">';
        for (const item of data.items) {
            const sizeMB = parseFloat(item.sizeMB) || (item.sizeBytes / (1024 * 1024));
            const sizeDisplay = sizeMB > 1024 ? (sizeMB / 1024).toFixed(1) + ' GB' : sizeMB.toFixed(0) + ' MB';
            const lic = item.license || {};
            const dlId = `peer-${item.filename}`;
            const typeIcon = item.type === 'ollama' ? '🤖' : item.type === 'zim' ? '📚' : '📄';
            const typeLabel = item.type === 'ollama' ? 'AI Model' : item.type === 'zim' ? 'Knowledge Pack' : 'File';

            html += `
                <div class="store-item card">
                    <div class="store-item-header">
                        <strong>${typeIcon} ${lic.name || item.filename}</strong>
                        <span class="tag tag-cyan">${sizeDisplay}</span>
                    </div>
                    <div style="font-size:10px;color:var(--text-dim);margin:4px 0;">${typeLabel}</div>
                    ${lic.license ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin: 4px 0;font-size:10px;">
                        <span class="tag" style="font-size:10px;color:var(--green);border-color:var(--green);background:transparent;">⚖️ ${lic.license}</span>
                        ${lic.source ? `<span style="color:var(--text-dim);">${lic.source}</span>` : ''}
                    </div>` : ''}
                    <div class="store-item-actions">
                        <div class="store-progress" id="prog-${dlId}" style="display:none">
                            <div class="store-progress-bar">
                                <div class="store-progress-fill" id="fill-${dlId}"></div>
                            </div>
                            <span class="store-progress-text" id="text-${dlId}"></span>
                        </div>
                        ${item.pullable !== false
                    ? `<button class="btn btn-primary btn-sm" id="btn-${dlId}"
                                onclick="NearbyModule.pullContent('${this.selectedPeer}', '${item.filename}', ${JSON.stringify(JSON.stringify(lic))})">
                                📥 Pull
                              </button>`
                    : `<span style="font-size:11px;color:var(--text-dim);font-style:italic;">Available on peer</span>`
                }
                    </div>
                </div>`;
        }
        html += '</div>';

        el.innerHTML = html;
    },

    async pullContent(peerIp, filename, licenseDataStr) {
        const dlId = `peer-${filename}`;
        const btn = document.getElementById(`btn-${dlId}`);
        const prog = document.getElementById(`prog-${dlId}`);

        let licenseData = null;
        try { licenseData = JSON.parse(licenseDataStr); } catch (e) { }

        if (btn) { btn.disabled = true; btn.textContent = '⏳ Pulling...'; }
        if (prog) prog.style.display = 'flex';

        try {
            const res = await authFetch(`${API}/api/store/peer/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerIp, filename, licenseData })
            });
            const data = await res.json();

            if (data.error) {
                if (btn) { btn.disabled = false; btn.textContent = '📥 Pull'; }
                if (prog) prog.style.display = 'none';
                alert('Pull failed: ' + data.error);
                return;
            }

            this.pollPullProgress(dlId);
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = '📥 Pull'; }
            if (prog) prog.style.display = 'none';
            alert('Pull failed: ' + err.message);
        }
    },

    async pollPullProgress(dlId) {
        const fill = document.getElementById(`fill-${dlId}`);
        const text = document.getElementById(`text-${dlId}`);
        const btn = document.getElementById(`btn-${dlId}`);

        const check = async () => {
            try {
                const res = await authFetch(`${API}/api/store/progress/${dlId}`);
                const data = await res.json();

                if (data.status === 'downloading') {
                    if (fill) fill.style.width = data.progress + '%';
                    if (text) text.textContent = data.progress + '%';
                    if (btn) btn.textContent = '⏳ ' + data.progress + '%';
                    setTimeout(check, 2000);
                } else if (data.status === 'complete') {
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--green)'; }
                    if (text) text.textContent = '✅ Complete!';
                    if (btn) { btn.textContent = '✅ Done'; btn.disabled = true; }
                } else if (data.status === 'failed' || data.status === 'corrupted') {
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--red)'; }
                    if (text) text.textContent = '❌ Failed';
                    if (btn) { btn.textContent = '📥 Retry'; btn.disabled = false; }
                    if (data.output) alert('Transfer failed:\n' + data.output);
                } else {
                    setTimeout(check, 3000);
                }
            } catch {
                setTimeout(check, 5000);
            }
        };
        check();
    }
};
