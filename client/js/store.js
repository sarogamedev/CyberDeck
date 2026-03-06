// ═══════════════════════════════════════════
// CyberDeck - Content Store
// ═══════════════════════════════════════════

const StoreModule = {
    catalog: [],
    itemConfigs: {},  // Store configs by ID — avoids inline JSON in onclick
    currentTab: 'catalog',

    async init() {
        const el = document.getElementById('mod-store');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Content Store</div>
                    <div class="module-subtitle">Download knowledge packs, LLM models & more</div>
                </div>
                <div class="store-tabs" style="display:flex; gap:8px; margin-top: 15px; overflow-x:auto; flex-wrap:nowrap; -webkit-overflow-scrolling:touch; padding-bottom:4px;">
                    <button id="tab-catalog" class="btn btn-primary" style="white-space:nowrap;font-size:13px;" onclick="StoreModule.switchTab('catalog')">📚 Catalog</button>
                    <button id="tab-downloaded" class="btn" style="background:var(--surface2);white-space:nowrap;font-size:13px;" onclick="StoreModule.switchTab('downloaded')">💾 Downloaded</button>
                    <button id="tab-nearby" class="btn" style="background:var(--surface2);white-space:nowrap;font-size:13px;" onclick="StoreModule.switchTab('nearby')">📡 Nearby</button>
                </div>
            </div>
            <div id="storeContent"><div class="loading-spinner"></div></div>`;

        await this.loadCatalog();
    },

    switchTab(tab) {
        this.currentTab = tab;
        const tabs = ['catalog', 'downloaded', 'nearby'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            if (t === tab) {
                btn.className = 'btn btn-primary';
                btn.style.background = '';
            } else {
                btn.className = 'btn';
                btn.style.background = 'var(--surface2)';
            }
        });

        if (tab === 'catalog') {
            this.renderCatalog();
            this.checkExistingDownloads();
        } else if (tab === 'downloaded') {
            this.renderDownloaded();
        } else if (tab === 'nearby') {
            this.renderNearby();
        }
    },

    async loadCatalog() {
        try {
            const res = await authFetch(`${API}/api/store/catalog`);
            const data = await res.json();
            this.catalog = data.categories || [];
            this.render();
            // Check what's already downloaded
            this.checkExistingDownloads();
        } catch (err) {
            document.getElementById('storeContent').innerHTML = `<div class="empty-state"><h3>Store unavailable</h3><p>${err.message}</p></div>`;
        }
    },

    render() {
        if (this.currentTab === 'catalog') this.renderCatalog();
        else if (this.currentTab === 'downloaded') this.renderDownloaded();
        else if (this.currentTab === 'nearby') this.renderNearby();
    },

    renderCatalog() {
        const el = document.getElementById('storeContent');
        let html = `<div style="background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 16px; margin-bottom: 20px; font-size: 12px; color: var(--text-dim);">
            ⚖️ <strong style="color: var(--cyan);">Attribution Notice:</strong> All downloadable content listed here is provided by third-party open-source projects. CyberDeck does not own, host, or claim ownership of any of these resources. Each item is subject to its original author's license terms. By downloading, you agree to comply with those terms. <a href="/third-party" target="_blank" style="color:var(--cyan);text-decoration:underline;">View all licenses →</a>
        </div>`;

        this.catalog.forEach(cat => {
            html += `<div class="store-category">
                <h3 style="margin-bottom:12px">${cat.icon} ${cat.name}</h3>
                <div class="store-items">`;

            cat.items.forEach(item => {
                // Store config in JS map — safe from HTML escaping issues
                this.itemConfigs[item.id] = {
                    url: item.url || '',
                    dirUrl: item.dirUrl || '',
                    pattern: item.pattern || '',
                    cmd: item.cmd || '',
                    type: item.type,
                    sha256: item.sha256 || '',
                    name: item.name || '',
                    license: item.license || '',
                    licenseUrl: item.licenseUrl || '',
                    source: item.source || '',
                    sourceUrl: item.sourceUrl || '',
                    distributor: item.distributor || ''
                };

                html += `
                    <div class="store-item card">
                        <div class="store-item-header">
                            <strong>${item.name}</strong>
                            <span class="tag tag-cyan" id="size-${item.id}">${item.size}</span>
                        </div>
                        <p style="font-size:12px;color:var(--text-dim);margin:6px 0">${item.desc}</p>
                        ${item.license ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:10px;">
                            <span class="tag" style="font-size:10px;color:var(--green);border-color:var(--green);background:transparent;">⚖️ License: ${item.license}</span>
                            ${item.licenseUrl ? `<a href="${item.licenseUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);text-decoration:underline;">View License</a>` : ''}
                            ${item.source ? `<span style="color:var(--text-dim);">Source: <a href="${item.sourceUrl || '#'}" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);text-decoration:underline;">${item.source}</a></span>` : ''}
                            ${item.distributor ? `<span style="color:var(--text-dim);font-style:italic;">${item.distributor}</span>` : ''}
                        </div>` : ''}
                        <div class="store-item-actions">
                            <div class="store-progress" id="prog-${item.id}" style="display:none">
                                <div class="power-bar"><div class="power-bar-fill" id="fill-${item.id}"></div></div>
                                <span class="store-prog-text" id="text-${item.id}"></span>
                            </div>
                            <div style="display:flex;gap:6px;align-items:center flex-wrap:wrap;">
                                <button class="btn btn-primary" id="btn-${item.id}"
                                    onclick="StoreModule.downloadItem('${item.id}')">
                                    ${item.type === 'manual' ? '🔗 Info' : '⬇ Download'}
                                </button>
                                <button class="btn" id="revoke-${item.id}" style="display:none;background:var(--surface2);color:#fff;font-size:12px"
                                    onclick="StoreModule.pauseDownload('${item.id}')">⏸ Pause</button>
                                <button class="btn" id="resume-${item.id}" style="display:none;background:var(--green);color:#000;font-size:12px"
                                    onclick="StoreModule.resumeDownload('${item.id}')">▶ Resume</button>
                                <button class="btn" id="cancel-${item.id}" style="display:none;background:var(--red);color:#fff;padding:6px 10px;font-size:12px"
                                    onclick="StoreModule.cancelDownload('${item.id}')">✕ Cancel</button>
                                <button class="btn" id="delete-${item.id}" style="display:none;background:var(--surface2);color:var(--red);border:1px solid var(--red);padding:6px 10px;font-size:12px"
                                    onclick="StoreModule.deleteItem('${item.id}')">🗑 Delete</button>
                            </div>
                        </div>
                    </div>`;
            });
            html += '</div></div>';
        });

        el.innerHTML = html;
        this.fetchExactSizes();
    },

    async renderDownloaded() {
        const el = document.getElementById('storeContent');
        el.innerHTML = '<div class="loading-spinner"></div>';
        try {
            const res = await authFetch(`${API}/api/store/downloaded`);
            const data = await res.json();

            if (!data.files || data.files.length === 0) {
                el.innerHTML = '<div class="card" style="text-align:center; padding: 40px;"><h3 style="color:var(--text-dim);">No offline content downloaded yet.</h3></div>';
                return;
            }

            let html = `
                <div class="card" style="overflow-x: auto;">
                    <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 14px;">
                        <thead>
                            <tr style="border-bottom: 2px solid var(--border); color: var(--text-dim);">
                                <th style="padding: 12px; min-width: 150px;">Item Name</th>
                                <th style="padding: 12px; width: 100px;">Type</th>
                                <th style="padding: 12px; width: 100px;">Size</th>
                                <th style="padding: 12px; min-width: 300px;">Absolute Path</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            data.files.forEach(f => {
                const icon = f.type === 'zim' ? '📚' : (f.type === 'ollama' ? '🧠' : '🗺️');
                const typeClr = f.type === 'zim' ? 'var(--cyan)' : (f.type === 'ollama' ? '#a855f7' : 'var(--green)');
                const sizeStr = (f.sizeBytes / 1024 / 1024 / 1024) > 1
                    ? (f.sizeBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
                    : (f.sizeBytes / 1024 / 1024).toFixed(1) + ' MB';

                html += `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 12px; font-weight: bold;">${icon} ${f.name}</td>
                        <td style="padding: 12px;"><span class="tag" style="color: ${typeClr}; border-color: ${typeClr}; background: transparent;">${f.type.toUpperCase()}</span></td>
                        <td style="padding: 12px; font-family: 'JetBrains Mono', monospace;">${sizeStr}</td>
                        <td style="padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim); word-break: break-all;">${f.absolutePath}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
            el.innerHTML = html;
        } catch (e) {
            el.innerHTML = `<div class="card" style="border-color: var(--red); color: var(--red);">Failed to load offline content: ${e.message}</div>`;
        }
    },

    async fetchExactSizes() {
        try {
            const res = await authFetch(`${API}/api/store/sizes`);
            const sizes = await res.json();
            for (const [id, exactSize] of Object.entries(sizes)) {
                const badge = document.getElementById(`size-${id}`);
                if (badge) {
                    badge.textContent = exactSize;
                }
            }
        } catch (err) {
            console.error('Failed to fetch exact sizes', err);
        }
    },

    async checkExistingDownloads() {
        try {
            const res = await authFetch(`${API}/api/store/status`);
            const status = await res.json();
            for (const [id, info] of Object.entries(status)) {
                if (info.status === 'complete') {
                    const btn = document.getElementById(`btn-${id}`);
                    const prog = document.getElementById(`prog-${id}`);
                    const fill = document.getElementById(`fill-${id}`);
                    const text = document.getElementById(`text-${id}`);
                    const deleteBtn = document.getElementById(`delete-${id}`);
                    if (btn) { btn.textContent = '✅ Done'; btn.disabled = true; }
                    if (prog) prog.style.display = 'flex';
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--green)'; }
                    if (text) text.textContent = 'Downloaded';
                    if (deleteBtn) deleteBtn.style.display = 'inline-block';
                }
            }
        } catch (e) { /* silently fail */ }
    },

    downloadItem(id) {
        const config = this.itemConfigs[id];
        if (!config) { alert('Unknown item'); return; }
        this.download(id, config);
    },

    async download(id, itemConfig) {
        const { url, dirUrl, pattern, cmd, type, sha256, name, license, licenseUrl, source, sourceUrl, distributor } = itemConfig;
        const btn = document.getElementById(`btn-${id}`);
        const prog = document.getElementById(`prog-${id}`);

        if (type === 'manual') {
            if (url) window.open(url, '_blank');
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Starting...';
        prog.style.display = 'flex';

        try {
            const res = await authFetch(`${API}/api/store/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, url, dirUrl, pattern, cmd, type, sha256, name, license, licenseUrl, source, sourceUrl, distributor })
            });
            const data = await res.json();

            if (data.error) {
                btn.disabled = false;
                btn.textContent = '⬇ Retry';
                prog.style.display = 'none';
                alert('Download error: ' + data.error);
                return;
            }

            // Poll progress
            this.pollProgress(id);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = '⬇ Retry';
            prog.style.display = 'none';
            alert('Download failed: ' + err.message);
        }
    },

    async pauseDownload(id) {
        try {
            await authFetch(`${API}/api/store/pause/${id}`, { method: 'POST' });
        } catch (e) {
            alert('Pause failed: ' + e.message);
        }
    },

    async resumeDownload(id) {
        try {
            await authFetch(`${API}/api/store/resume/${id}`, { method: 'POST' });
            this.pollProgress(id); // Restart polling
        } catch (e) {
            alert('Resume failed: ' + e.message);
        }
    },

    async cancelDownload(id) {
        if (!confirm('Cancel this download?')) return;
        try {
            await authFetch(`${API}/api/store/cancel/${id}`, { method: 'POST' });
            const btn = document.getElementById(`btn-${id}`);
            const cancelBtn = document.getElementById(`cancel-${id}`);
            const pauseBtn = document.getElementById(`revoke-${id}`);
            const resumeBtn = document.getElementById(`resume-${id}`);
            const prog = document.getElementById(`prog-${id}`);
            const fill = document.getElementById(`fill-${id}`);
            const text = document.getElementById(`text-${id}`);

            if (btn) { btn.textContent = '⬇ Download'; btn.disabled = false; }
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'none';
            if (fill) { fill.style.width = '0%'; fill.style.background = ''; }
            if (text) text.textContent = '';
            if (prog) prog.style.display = 'none';
        } catch (e) {
            alert('Cancel failed: ' + e.message);
        }
    },

    async deleteItem(id) {
        if (!confirm('Delete this downloaded content? This cannot be undone.')) return;
        try {
            const res = await authFetch(`${API}/api/store/delete/${id}`, { method: 'DELETE' });
            const data = await res.json();
            const btn = document.getElementById(`btn-${id}`);
            const deleteBtn = document.getElementById(`delete-${id}`);
            const prog = document.getElementById(`prog-${id}`);
            const fill = document.getElementById(`fill-${id}`);
            const text = document.getElementById(`text-${id}`);
            if (btn) { btn.textContent = '⬇ Download'; btn.disabled = false; }
            if (deleteBtn) deleteBtn.style.display = 'none';
            if (fill) { fill.style.width = '0%'; fill.style.background = ''; }
            if (text) text.textContent = '';
            if (prog) prog.style.display = 'none';
            alert(data.message || 'Deleted successfully');
        } catch (e) {
            alert('Delete failed: ' + e.message);
        }
    },

    async pollProgress(id) {
        const fill = document.getElementById(`fill-${id}`);
        const text = document.getElementById(`text-${id}`);
        const btn = document.getElementById(`btn-${id}`);
        const cancelBtn = document.getElementById(`cancel-${id}`);
        const deleteBtn = document.getElementById(`delete-${id}`);
        const pauseBtn = document.getElementById(`revoke-${id}`);
        const resumeBtn = document.getElementById(`resume-${id}`);
        const mdItemType = this.itemConfigs[id]?.type;

        const check = async () => {
            try {
                const res = await authFetch(`${API}/api/store/progress/${id}`);
                const data = await res.json();

                if (data.status === 'discovering') {
                    text.textContent = 'Finding...';
                    btn.textContent = '🔍 Finding...';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    setTimeout(check, 2000);
                } else if (data.status === 'downloading') {
                    fill.style.width = data.progress + '%';
                    text.textContent = data.progress + '%';
                    btn.textContent = '⏳ ' + data.progress + '%';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    if (pauseBtn && mdItemType === 'zim') pauseBtn.style.display = 'inline-block';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    setTimeout(check, 2000);
                } else if (data.status === 'paused') {
                    fill.style.background = 'var(--surface2)';
                    fill.style.width = data.progress + '%';
                    text.textContent = data.progress + '% (Paused)';
                    btn.textContent = '⏸ Paused';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'inline-block';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    // We don't loop here. Resume will restart polling.
                } else if (data.status === 'complete') {
                    fill.style.width = '100%';
                    fill.style.background = 'var(--green)';
                    text.textContent = 'Complete!';
                    btn.textContent = '✅ Done';
                    btn.disabled = true;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    if (deleteBtn) deleteBtn.style.display = 'inline-block';
                } else if (data.status === 'failed') {
                    fill.style.width = '100%';
                    fill.style.background = 'var(--red)';
                    text.textContent = 'Failed';
                    btn.textContent = '⬇ Retry';
                    btn.disabled = false;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    if (data.output) alert('Download failed:\n' + data.output);
                } else if (data.status === 'corrupted') {
                    fill.style.width = '100%';
                    fill.style.background = 'var(--red)';
                    text.textContent = '✗ Integrity Failure';
                    btn.textContent = '⬇ Retry';
                    btn.disabled = false;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    if (data.output) alert('⚠️ Integrity Check Failed:\n' + data.output);
                } else if (data.status === 'cancelled') {
                    // Already handled in cancelDownload
                } else {
                    setTimeout(check, 3000);
                }
            } catch {
                setTimeout(check, 5000);
            }
        };
        check();
    },

    // ============================================================
    // NEARBY CYBERDECKS — LAN Content Sync
    // ============================================================

    peerLibrary: null,
    peerIp: '',

    renderNearby() {
        const el = document.getElementById('storeContent');
        el.innerHTML = `
            <div style="background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 8px 0; font-size: 16px;">📡 Scan Nearby CyberDeck</h3>
                <p style="font-size: 12px; color: var(--text-dim); margin-bottom: 12px;">
                    Enter the IP address of another CyberDeck on your network to browse and pull their downloaded content.
                </p>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="text" id="peer-ip-input" class="input" placeholder="e.g. 192.168.1.42"
                        value="${this.peerIp}" style="flex: 1; max-width: 240px;"
                        onkeydown="if(event.key==='Enter') StoreModule.scanPeer()">
                    <button class="btn btn-primary" onclick="StoreModule.scanPeer()" id="scan-peer-btn">🔍 Scan</button>
                </div>
            </div>
            <div id="peer-library-content">
                ${this.peerLibrary ? '' : '<div class="empty-state"><h3>No peer scanned yet</h3><p>Enter a CyberDeck IP address and click Scan to browse their content library.</p></div>'}
            </div>`;

        if (this.peerLibrary) {
            this.renderPeerLibrary();
        }
    },

    async scanPeer() {
        const ipInput = document.getElementById('peer-ip-input');
        const btn = document.getElementById('scan-peer-btn');
        const ip = ipInput.value.trim();
        if (!ip) { alert('Please enter a peer IP address'); return; }

        this.peerIp = ip;
        btn.disabled = true;
        btn.textContent = '⏳ Scanning...';
        const contentEl = document.getElementById('peer-library-content');
        contentEl.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/store/peer/library`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerIp: ip })
            });
            const data = await res.json();

            if (!data.success) {
                contentEl.innerHTML = `<div class="empty-state"><h3>❌ Connection Failed</h3><p>${data.error || 'Could not reach peer.'}</p><p style="font-size:12px;color:var(--text-dim);">Make sure the other CyberDeck is running and reachable on port 8443.</p></div>`;
                btn.disabled = false;
                btn.textContent = '🔍 Scan';
                return;
            }

            this.peerLibrary = data;
            this.renderPeerLibrary();
        } catch (err) {
            contentEl.innerHTML = `<div class="empty-state"><h3>❌ Error</h3><p>${err.message}</p></div>`;
        }

        btn.disabled = false;
        btn.textContent = '🔍 Scan';
    },

    renderPeerLibrary() {
        const el = document.getElementById('peer-library-content');
        const data = this.peerLibrary;
        if (!data || !data.items) { el.innerHTML = '<div class="empty-state"><h3>No data</h3></div>'; return; }

        if (data.items.length === 0) {
            el.innerHTML = `<div class="empty-state"><h3>📭 Empty Library</h3><p>${data.node || data.peer} has no downloaded content to share.</p></div>`;
            return;
        }

        let html = `<div style="margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 14px;">🖥️ <strong style="color: var(--cyan);">${data.node || data.peer}</strong></span>
            <span class="tag tag-cyan">${data.items.length} item${data.items.length !== 1 ? 's' : ''}</span>
        </div>`;

        html += '<div class="store-grid">';
        for (const item of data.items) {
            const sizeMB = item.sizeMB || (item.sizeBytes / (1024 * 1024)).toFixed(1);
            const sizeDisplay = sizeMB > 1024 ? (sizeMB / 1024).toFixed(1) + ' GB' : sizeMB + ' MB';
            const lic = item.license || {};
            const dlId = `peer-${item.filename}`;

            html += `
                <div class="store-item card">
                    <div class="store-item-header">
                        <strong>${lic.name || item.filename}</strong>
                        <span class="tag tag-cyan">${sizeDisplay}</span>
                    </div>
                    ${lic.license ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin: 8px 0;font-size:10px;">
                        <span class="tag" style="font-size:10px;color:var(--green);border-color:var(--green);background:transparent;">⚖️ License: ${lic.license}</span>
                        ${lic.source ? `<span style="color:var(--text-dim);">Source: ${lic.source}</span>` : ''}
                        ${lic.distributor ? `<span style="color:var(--text-dim);font-style:italic;">${lic.distributor}</span>` : ''}
                    </div>` : ''}
                    <div class="store-item-actions">
                        <div class="store-progress" id="prog-${dlId}" style="display:none">
                            <div class="store-progress-bar">
                                <div class="store-progress-fill" id="fill-${dlId}"></div>
                            </div>
                            <span class="store-progress-text" id="text-${dlId}"></span>
                        </div>
                        <button class="btn btn-primary btn-sm" id="btn-${dlId}"
                            onclick="StoreModule.pullFromPeer('${this.peerIp}', '${item.filename}', ${JSON.stringify(JSON.stringify(lic))})">
                            📥 Pull
                        </button>
                    </div>
                </div>`;
        }
        html += '</div>';

        el.innerHTML = html;
    },

    async pullFromPeer(peerIp, filename, licenseDataStr) {
        const dlId = `peer-${filename}`;
        const btn = document.getElementById(`btn-${dlId}`);
        const prog = document.getElementById(`prog-${dlId}`);

        let licenseData = null;
        try { licenseData = JSON.parse(licenseDataStr); } catch (e) { }

        btn.disabled = true;
        btn.textContent = '⏳ Pulling...';
        prog.style.display = 'flex';

        try {
            const res = await authFetch(`${API}/api/store/peer/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerIp, filename, licenseData })
            });
            const data = await res.json();

            if (data.error) {
                btn.disabled = false;
                btn.textContent = '📥 Pull';
                prog.style.display = 'none';
                alert('Pull failed: ' + data.error);
                return;
            }

            // Poll progress using existing progress poller
            this.pollProgress(dlId);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = '📥 Pull';
            prog.style.display = 'none';
            alert('Pull failed: ' + err.message);
        }
    }
};
