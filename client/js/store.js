// ═══════════════════════════════════════════
// CyberDeck - Content Store
// ═══════════════════════════════════════════

const StoreModule = {
    _pollTimers: {},
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
                <div class="store-tabs">
                    <button id="tab-catalog" class="btn btn-primary" onclick="StoreModule.switchTab('catalog')">Catalog</button>
                    <button id="tab-downloaded" class="btn" onclick="StoreModule.switchTab('downloaded')">Downloaded</button>
                </div>
            </div>
            <div id="storeContent"><div class="loading-spinner"></div></div>`;

        // Catalog item ids come from catalog.json.
        delegate(document.getElementById('mod-store'), '[data-store-action]', (el) => {
            const id = el.dataset.itemId;
            switch (el.dataset.storeAction) {
                case 'downloadItem': StoreModule.downloadItem(id); break;
                case 'pauseDownload': StoreModule.pauseDownload(id); break;
                case 'resumeDownload': StoreModule.resumeDownload(id); break;
                case 'cancelDownload': StoreModule.cancelDownload(id); break;
            }
        });


        await this.loadCatalog();
    },

    switchTab(tab) {
        this.currentTab = tab;
        const tabs = ['catalog', 'downloaded'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            if (t === tab) {
                btn.className = 'btn primary';
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
            document.getElementById('storeContent').innerHTML = `<div class="empty-state"><h3>Store unavailable</h3><p>${escapeHtml(err.message)}</p></div>`;
        }
    },

    render() {
        if (this.currentTab === 'catalog') this.renderCatalog();
        else if (this.currentTab === 'downloaded') this.renderDownloaded();
    },

    renderCatalog() {
        const el = document.getElementById('storeContent');
        let html = `<div class="store-notice">
            <strong>Attribution Notice:</strong> All content is provided by third-party projects. CyberDeck does not claim ownership. Each item is subject to its author's license terms. <a href="/third-party" target="_blank">View Licenses →</a>
        </div>`;

        this.catalog.forEach(cat => {
            html += `<div class="store-category">
                <h3>${escapeHtml(cat.name)}</h3>
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
                            <div class="store-item-name">${escapeHtml(item.name)}</div>
                            <span class="store-tag" id="size-${item.id}">${escapeHtml(item.size)}</span>
                        </div>
                        <div class="store-item-desc">${escapeHtml(item.desc)}</div>
                        ${item.license ? `<div class="store-item-meta">
                            <span class="store-tag">LICENSE: ${escapeHtml(item.license)}</span>
                            ${item.licenseUrl ? `<a href="${escapeHtml(item.licenseUrl)}" target="_blank" rel="noopener noreferrer">VIEW LICENSE</a>` : ''}
                            ${item.source ? `<span style="color:var(--text-dim);">SOURCE: <a href="${escapeHtml(item.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source)}</a></span>` : ''}
                        </div>` : ''}
                        <div class="store-item-actions">
                            <div class="store-progress" id="prog-${item.id}" style="display:none">
                                <div class="power-bar"><div class="power-bar-fill" id="fill-${item.id}"></div></div>
                                <span class="store-prog-text" id="text-${item.id}"></span>
                            </div>
                            <div class="store-btn-group">
                                <button class="btn btn-primary" id="btn-${item.id}"
                                    data-store-action="downloadItem" data-item-id="${escapeHtml(item.id)}">
                                    ${item.type === 'manual' ? 'INFO' : (Auth.user?.role === 'admin' ? 'DOWNLOAD' : 'REQUEST')}
                                </button>
                                <button class="btn" id="revoke-${item.id}" style="display:none;"
                                    data-store-action="pauseDownload" data-item-id="${escapeHtml(item.id)}">PAUSE</button>
                                <button class="btn btn-success-tac" id="resume-${item.id}" style="display:none;"
                                    data-store-action="resumeDownload" data-item-id="${escapeHtml(item.id)}">RESUME</button>
                                <button class="btn btn-delete" id="cancel-${item.id}" style="display:none;"
                                    data-store-action="cancelDownload" data-item-id="${escapeHtml(item.id)}">CANCEL</button>
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
                <div class="store-table-container">
                    <table class="store-table">
                        <thead>
                            <tr>
                                <th>Item Name</th>
                                <th>Type</th>
                                <th>Size</th>
                                <th>Path / ID</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            data.files.forEach(f => {
                const icon = f.type === 'zim' ? '📚' : (f.type === 'ollama' ? '🧠' : '🗺️');
                const sizeStr = (f.sizeBytes / 1024 / 1024 / 1024) > 1
                    ? (f.sizeBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
                    : (f.sizeBytes / 1024 / 1024).toFixed(1) + ' MB';

                // For ZIM files, we usually want to use the pattern key if available, 
                // but the backend robust delete now handles direct filenames too.
                const deleteId = f.id; 

                let progressHtml = '';
                if (f.isDownloading) {
                    progressHtml = `
                        <div class="store-progress" id="prog-${f.id}" style="display:flex; margin-top:6px; background:transparent; padding:0; border:none;">
                            <div class="power-bar" style="margin-right:10px; width:100px; height:8px;"><div class="power-bar-fill" id="fill-${f.id}" style="width:${f.progress}%"></div></div>
                            <span class="store-prog-text" id="text-${f.id}" style="font-size:10px">${f.status === 'paused' ? 'Paused' : f.progress + '%'}</span>
                        </div>
                    `;
                }

                html += `
                    <tr>
                        <td style="font-weight: bold;">${icon} ${escapeHtml(f.name)}</td>
                        <td><span class="store-type-tag">${escapeHtml(String(f.type || "").toUpperCase())}</span></td>
                        <td style="font-family: 'JetBrains Mono', monospace;">${sizeStr}</td>
                        <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim); word-break: break-all;">
                            ${escapeHtml(f.relativePath || f.name)}
                            ${progressHtml}
                        </td>
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
            el.innerHTML = `<div class="card" style="border-color: var(--red); color: var(--red);">Failed to load offline content: ${escapeHtml(e.message)}</div>`;
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
                    if (btn) { btn.textContent = 'DONE'; btn.disabled = true; }
                    if (prog) prog.style.display = 'none';
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--border)'; }
                    if (text) text.textContent = 'Downloaded';
                } else if (info.status === 'requested') {
                    const btn = document.getElementById(`btn-${id}`);
                    if (btn) { btn.textContent = 'REQUESTED'; btn.disabled = true; }
                } else if (info.status && info.status !== 'idle' && info.status !== 'failed' && info.status !== 'cancelled') {
                    this.pollProgress(id);
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

        if (btn) btn.disabled = true;
        if (btn) btn.textContent = '⏳ Starting...';
        prog.style.display = 'flex';

        try {
            const res = await authFetch(`${API}/api/store/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, url, dirUrl, pattern, cmd, type, sha256, name, license, licenseUrl, source, sourceUrl, distributor })
            });
            const data = await res.json();

            if (data.error) {
                if (btn) btn.disabled = false;
                if (btn) btn.textContent = '⬇ Retry';
                prog.style.display = 'none';
                alert('Download error: ' + data.error);
                return;
            }

            // Poll progress
            this.pollProgress(id);
        } catch (err) {
            if (btn) btn.disabled = false;
            if (btn) btn.textContent = '⬇ Retry';
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

    /** Stop every progress poll chain. Called on logout. */
    stopPolling() {
        for (const id of Object.keys(this._pollTimers)) clearTimeout(this._pollTimers[id]);
        this._pollTimers = {};
    },

    async pollProgress(id) {
        const mdItemType = this.itemConfigs[id]?.type;

        // One tracked timer per download id. resumeDownload and
        // checkExistingDownloads both call this, and each call used to start a
        // fresh untracked setTimeout chain that nothing could ever stop.
        if (this._pollTimers[id]) {
            clearTimeout(this._pollTimers[id]);
            delete this._pollTimers[id];
        }
        const schedule = (ms) => { this._pollTimers[id] = setTimeout(check, ms); };
        const stop = () => { delete this._pollTimers[id]; };

        const check = async () => {
            const fill = document.getElementById(`fill-${id}`);
            const text = document.getElementById(`text-${id}`);
            const btn = document.getElementById(`btn-${id}`);
            const cancelBtn = document.getElementById(`cancel-${id}`);
            const pauseBtn = document.getElementById(`revoke-${id}`);
            const resumeBtn = document.getElementById(`resume-${id}`);
            const prog = document.getElementById(`prog-${id}`);

            try {
                const res = await authFetch(`${API}/api/store/progress/${id}`);
                const data = await res.json();

                if (data.status === 'discovering') {
                    if (prog) prog.style.display = 'flex';
                    if (text) text.textContent = 'Finding...';
                    if (btn) btn.textContent = '🔍 Finding...';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    schedule(2000);
                } else if (data.status === 'downloading') {
                    if (prog) prog.style.display = 'flex';
                    if (fill) fill.style.width = data.progress + '%';
                    if (fill) fill.style.background = 'var(--primary)';
                    if (text) text.textContent = data.progress + '%';
                    if (btn) btn.textContent = data.progress + '%';
                    if (cancelBtn) cancelBtn.style.display = 'block';
                    if (pauseBtn && mdItemType === 'zim') pauseBtn.style.display = 'block';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    schedule(2000);
                } else if (data.status === 'verifying') {
                    if (prog) prog.style.display = 'flex';
                    if (fill) fill.style.width = '100%';
                    if (fill) fill.style.background = 'var(--cyan)';
                    if (text) text.textContent = 'Verifying...';
                    if (btn) btn.textContent = 'Verifying...';
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    schedule(2000);
                } else if (data.status === 'paused') {
                    stop();
                    if (prog) prog.style.display = 'flex';
                    if (fill) fill.style.background = 'var(--surface2)';
                    if (fill) fill.style.width = data.progress + '%';
                    if (text) text.textContent = data.progress + '% (Paused)';
                    if (btn) btn.textContent = '⏸ Paused';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'inline-block';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    // We don't loop here. Resume will restart polling.
                } else if (data.status === 'requested') {
                    if (prog) prog.style.display = 'flex';
                    if (fill) fill.style.background = 'var(--surface2)';
                    if (fill) fill.style.width = '100%';
                    if (text) text.textContent = 'Pending Approval...';
                    if (btn) { btn.textContent = 'REQUESTED'; btn.disabled = true; }
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                    schedule(5000);
                } else if (data.status === 'complete') {
                    stop();
                    if (prog) prog.style.display = 'none';
                    if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--border)'; }
                    if (text) text.textContent = 'Complete';
                    if (btn) btn.textContent = 'DONE';
                    if (btn) btn.disabled = true;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    // Force refresh all buttons to sync "DONE" state
                    this.checkExistingDownloads();
                } else if (data.status === 'failed') {
                    stop();
                    if (fill) fill.style.width = '100%';
                    if (fill) fill.style.background = 'var(--red)';
                    if (text) text.textContent = 'Failed';
                    if (btn) btn.textContent = '⬇ Retry';
                    if (btn) btn.disabled = false;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    if (data.output) alert('Download failed:\n' + data.output);
                } else if (data.status === 'corrupted') {
                    if (fill) fill.style.width = '100%';
                    if (fill) fill.style.background = 'var(--red)';
                    if (text) text.textContent = '✗ Integrity Failure';
                    if (btn) btn.textContent = '⬇ Retry';
                    if (btn) btn.disabled = false;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                    if (data.output) alert('Integrity Check Failed:\n' + data.output);
                } else if (data.status === 'idle') {
                    if (btn) {
                        if (btn) btn.textContent = Auth.user?.role === 'admin' ? 'DOWNLOAD' : 'REQUEST';
                        if (btn) btn.disabled = false;
                    }
                    if (prog) prog.style.display = 'none';
                    if (fill) fill.style.width = '0%';
                    if (text) text.textContent = '';
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    return; // Stop polling because request was probably rejected or download never started
                } else {
                    schedule(3000);
                }
            } catch {
                schedule(5000);
            }
        };
        check();
    }
};

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.StoreModule = StoreModule;
