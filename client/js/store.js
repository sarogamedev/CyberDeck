// ═══════════════════════════════════════════
// CyberDeck - Content Store
// ═══════════════════════════════════════════

const StoreModule = {
    catalog: [],

    async init() {
        const el = document.getElementById('mod-store');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Content Store</div>
                    <div class="module-subtitle">Download knowledge packs, LLM models & more</div>
                </div>
            </div>
            <div id="storeContent"><div class="loading-spinner"></div></div>`;
        await this.loadCatalog();
    },

    async loadCatalog() {
        try {
            const res = await authFetch(`${API}/api/store/catalog`);
            const data = await res.json();
            this.catalog = data.categories || [];
            this.render();
        } catch (err) {
            document.getElementById('storeContent').innerHTML = `<div class="empty-state"><h3>Store unavailable</h3><p>${err.message}</p></div>`;
        }
    },

    render() {
        const el = document.getElementById('storeContent');
        let html = '';

        this.catalog.forEach(cat => {
            html += `<div class="store-category">
                <h3 style="margin-bottom:12px">${cat.icon} ${cat.name}</h3>
                <div class="store-items">`;

            cat.items.forEach(item => {
                html += `
                    <div class="store-item card">
                        <div class="store-item-header">
                            <strong>${item.name}</strong>
                            <span class="tag tag-cyan">${item.size}</span>
                        </div>
                        <p style="font-size:12px;color:var(--text-dim);margin:6px 0">${item.desc}</p>
                        <div class="store-item-actions">
                            <div class="store-progress" id="prog-${item.id}" style="display:none">
                                <div class="power-bar"><div class="power-bar-fill" id="fill-${item.id}"></div></div>
                                <span class="store-prog-text" id="text-${item.id}"></span>
                            </div>
                            <button class="btn btn-primary" id="btn-${item.id}"
                                onclick="StoreModule.download('${item.id}', ${JSON.stringify({
                    url: item.url || '', dirUrl: item.dirUrl || '', pattern: item.pattern || '',
                    cmd: item.cmd || '', type: item.type
                }).replace(/"/g, '&quot;')})">
                                ${item.type === 'manual' ? '🔗 Info' : '⬇ Download'}
                            </button>
                        </div>
                    </div>`;
            });
            html += '</div></div>';
        });

        el.innerHTML = html;
    },

    async download(id, itemConfig) {
        const { url, dirUrl, pattern, cmd, type } = itemConfig;
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
                body: JSON.stringify({ id, url, dirUrl, pattern, cmd, type })
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

    async pollProgress(id) {
        const fill = document.getElementById(`fill-${id}`);
        const text = document.getElementById(`text-${id}`);
        const btn = document.getElementById(`btn-${id}`);

        const check = async () => {
            try {
                const res = await authFetch(`${API}/api/store/progress/${id}`);
                const data = await res.json();

                if (data.status === 'discovering') {
                    text.textContent = 'Finding...';
                    btn.textContent = '🔍 Finding...';
                    setTimeout(check, 2000);
                } else if (data.status === 'downloading') {
                    fill.style.width = data.progress + '%';
                    text.textContent = data.progress + '%';
                    btn.textContent = '⏳ ' + data.progress + '%';
                    setTimeout(check, 2000);
                } else if (data.status === 'complete') {
                    fill.style.width = '100%';
                    fill.style.background = 'var(--green)';
                    text.textContent = 'Complete!';
                    btn.textContent = '✅ Done';
                    btn.disabled = true;
                } else if (data.status === 'failed') {
                    fill.style.width = '100%';
                    fill.style.background = 'var(--red)';
                    text.textContent = 'Failed';
                    btn.textContent = '⬇ Retry';
                    btn.disabled = false;
                    if (data.output) alert('Download failed:\n' + data.output);
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
