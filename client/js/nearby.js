// ═══════════════════════════════════════════
// CyberDeck - Nearby CyberDecks (LAN Content Sync)
// ═══════════════════════════════════════════

const NearbyModule = {
    peers: [],
    selectedPeer: null,
    peerLibrary: null,
    pollTimer: null,
    selfIp: 'Detecting...',
    peerItems: [],
    activePulls: JSON.parse(localStorage.getItem('nearby_active_pulls') || '[]'),

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
            if (data.self && data.self !== '127.0.0.1' && data.self !== '::1') {
                this.selfIp = data.self;
            } else {
                const currentHost = window.location.hostname;
                if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
                    this.selfIp = currentHost;
                } else if (data.self) {
                    this.selfIp = data.self;
                }
            }
            this.renderPeers();

            // Auto-reconnect if we have a saved peer
            if (this.selectedPeer && this.peerItems.length === 0) {
                this.connectToPeer(this.selectedPeer);
            }

            // Resume polling for saved active pulls
            if (this.activePulls && Array.isArray(this.activePulls)) {
                this.activePulls.forEach(id => this.pollPullProgress(id));
            }
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
                    <p style="font-size:12px;color:var(--text-dim);">Make sure the other CyberDeck is running on port 8443.</p>
                    <button class="btn btn-sm" onclick="NearbyModule.connectToPeer('${ip}')">🔄 Retry</button></div>`;
                return;
            }

            localStorage.setItem('nearby_selected_peer', ip);
            this.peerItems = data.items || [];
            this.renderLibrary();
        } catch (err) {
            libEl.innerHTML = `<div class="empty-state"><h3>❌ Error</h3><p>${err.message}</p>
                <button class="btn btn-sm" onclick="NearbyModule.connectToPeer('${ip}')">🔄 Retry</button></div>`;
        }
    },

    renderLibrary() {
        const el = document.getElementById('nearby-library');
        const items = this.peerItems;
        if (!items || items.length === 0) {
            el.innerHTML = `<div class="empty-state"><h3>📭 Empty Library</h3><p>${this.selectedPeer} has no content to share.</p></div>`;
            return;
        }

        let html = `<div style="margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 14px;">🖥️ <strong style="color: var(--cyan);">${this.selectedPeer}</strong></span>
            <span class="tag tag-cyan">${items.length} item${items.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-sm" style="font-size:12px;" onclick="NearbyModule.selectPeer('${this.selectedPeer}')">🔄 Refresh</button>
        </div>`;

        html += '<div class="store-grid">';
        items.forEach((item, index) => {
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
                        <div class="store-progress" id="prog-${dlId}" style="display:none; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px;">
                                <span id="speed-${dlId}" style="color: var(--cyan);">0 B/s</span>
                                <span id="text-${dlId}">0%</span>
                            </div>
                            <div class="store-progress-bar">
                                <div class="store-progress-fill" id="fill-${dlId}"></div>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <button class="btn btn-sm" id="pause-${dlId}" onclick="NearbyModule.controlPull('${dlId}', 'pause')" style="font-size: 9px; padding: 2px 6px;">⏸️ Pause</button>
                                <button class="btn btn-sm" id="resume-${dlId}" onclick="NearbyModule.controlPull('${dlId}', 'resume')" style="font-size: 9px; padding: 2px 6px; display: none;">▶️ Resume</button>
                                <button class="btn btn-sm" id="cancel-${dlId}" onclick="NearbyModule.controlPull('${dlId}', 'cancel')" style="font-size: 9px; padding: 2px 6px; color: var(--red);">✖️ Cancel</button>
                            </div>
                        </div>
                        ${item.pullable !== false
                    ? `<button class="btn btn-primary btn-sm" id="btn-${dlId}"
                                onclick="NearbyModule.pullContent(${index})">
                                📥 Pull
                              </button>`
                    : `<span style="font-size:11px;color:var(--text-dim);font-style:italic;">Available on peer</span>`
                }
                    </div>
                </div>`;
        });
        html += '</div>';

        el.innerHTML = html;
    },

    async pullContent(itemIndex) {
        const item = this.peerItems[itemIndex];
        if (!item) return;

        const peerIp = this.selectedPeer;
        const filename = item.filename;
        const licenseData = item.license;

        const dlId = `peer-${filename}`;
        const btn = document.getElementById(`btn-${dlId}`);
        const prog = document.getElementById(`prog-${dlId}`);

        if (btn) { btn.disabled = true; btn.textContent = '⏳ Pulling...'; }
        if (prog) prog.style.display = 'flex';

        try {
            const res = await authFetch(`${API}/api/store/peer/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerIp, filename, licenseData, type: item.type })
            });
            const data = await res.json();

            if (data.error) {
                if (btn) { btn.disabled = false; btn.textContent = '📥 Pull'; }
                if (prog) prog.style.display = 'none';
                alert('Pull failed: ' + data.error);
                return;
            }

            if (!this.activePulls.includes(dlId)) {
                this.activePulls.push(dlId);
                localStorage.setItem('nearby_active_pulls', JSON.stringify(this.activePulls));
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
        const speedEl = document.getElementById(`speed-${dlId}`);
        const btn = document.getElementById(`btn-${dlId}`);
        const pauseBtn = document.getElementById(`pause-${dlId}`);
        const resumeBtn = document.getElementById(`resume-${dlId}`);

        let lastBytes = 0;
        let lastTime = Date.now();

        const check = async () => {
            try {
                const res = await authFetch(`${API}/api/store/progress/${dlId}`);
                const data = await res.json();

                if (data.status === 'downloading' || data.status === 'paused') {
                    if (fill) fill.style.width = data.progress + '%';
                    if (text) text.textContent = data.progress + '%';
                    if (btn) btn.textContent = '⏳ ' + data.progress + '%';

                    if (data.status === 'paused') {
                        if (pauseBtn) pauseBtn.style.display = 'none';
                        if (resumeBtn) resumeBtn.style.display = 'block';
                        if (speedEl) speedEl.textContent = 'Paused';
                    } else {
                        if (pauseBtn) pauseBtn.style.display = 'block';
                        if (resumeBtn) resumeBtn.style.display = 'none';

                        // Calculate speed
                        const now = Date.now();
                        const duration = (now - lastTime) / 1000;
                        if (duration >= 1) {
                            const bytes = data.progressBytes || 0;
                            const speed = (bytes - lastBytes) / duration;
                            if (speedEl) speedEl.textContent = speed > 1024 * 1024
                                ? (speed / (1024 * 1024)).toFixed(1) + ' MB/s'
                                : (speed / 1024).toFixed(1) + ' KB/s';
                            lastBytes = bytes;
                            lastTime = now;
                        }
                    }
                    setTimeout(check, 2000);
                } else if (data.status === 'complete') {
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--green)'; }
                    if (text) text.textContent = '✅ Complete!';
                    if (btn) { btn.textContent = '✅ Done'; btn.disabled = true; }
                    if (speedEl) speedEl.textContent = 'Finished';
                    this.activePulls = this.activePulls.filter(id => id !== dlId);
                    localStorage.setItem('nearby_active_pulls', JSON.stringify(this.activePulls));
                } else if (data.status === 'failed' || data.status === 'corrupted' || data.status === 'cancelled') {
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--red)'; }
                    if (text) text.textContent = data.status === 'cancelled' ? '✖️ Cancelled' : '❌ Failed';
                    if (btn) { btn.textContent = '📥 Retry'; btn.disabled = false; }
                    if (speedEl) speedEl.textContent = '';
                    if (data.status === 'cancelled') {
                        this.activePulls = this.activePulls.filter(id => id !== dlId);
                        localStorage.setItem('nearby_active_pulls', JSON.stringify(this.activePulls));
                    }
                    if (data.status === 'failed' && data.output) alert('Transfer failed:\n' + data.output);
                } else {
                    setTimeout(check, 3000);
                }
            } catch {
                setTimeout(check, 5000);
            }
        };
        check();
    },

    async controlPull(dlId, action) {
        try {
            await authFetch(`${API}/api/store/progress/${dlId}/${action}`, { method: 'POST' });
            if (action === 'cancel') {
                const prog = document.getElementById(`prog-${dlId}`);
                if (prog) prog.style.display = 'none';
                const btn = document.getElementById(`btn-${dlId}`);
                if (btn) { btn.disabled = false; btn.textContent = '📥 Pull'; }
            } else {
                // Discover updated status immediately
                this.pollPullProgress(dlId);
            }
        } catch (e) {
            alert(`Failed to ${action} transfer: ${e.message}`);
        }
    }
};
