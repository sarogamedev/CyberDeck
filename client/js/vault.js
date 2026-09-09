// ═══════════════════════════════════════════
// CyberDeck - Encrypted Vault
// ═══════════════════════════════════════════

const VaultModule = {
    unlocked: false,
    vaultToken: null,
    files: [],

    async init() {
        const el = document.getElementById('mod-vault');
        el.innerHTML = '<div class="loading-spinner"></div>';

        // Delegated handlers for file rows. Vault filenames are user-supplied
        // and were previously interpolated into onclick attributes, where the
        // escape-then-replace idiom failed on backslashes and double quotes.
        delegate(el, '[data-vault-action]', (target) => {
            const id = target.dataset.fileId;
            const name = target.dataset.fileName;
            if (target.dataset.vaultAction === 'retrieve') VaultModule.retrieve(id, name);
            else if (target.dataset.vaultAction === 'delete') VaultModule.deleteFile(id, name);
        });

        try {
            const res = await authFetch(`${API}/api/vault/status`);
            const data = await res.json();

            if (!data.initialized) {
                this.showSetup(el);
            } else {
                this.showLogin(el);
            }
        } catch (err) {
            el.innerHTML = `<div class="empty-state"><h3>Vault unavailable</h3><p>${escapeHtml(err.message)}</p></div>`;
        }
    },

    showSetup(el) {
        el.innerHTML = `
            <div class="vault-center">
                <div class="vault-lock-icon">🔐</div>
                <h2>Create Your Vault</h2>
                <p style="color:var(--text-dim);margin:12px 0">Set a password to encrypt your files with AES-256</p>
                <div class="login-field" style="max-width:300px;margin:0 auto">
                    <label>Vault Password</label>
                    <input type="password" id="vaultNewPass" placeholder="minimum 4 characters">
                </div>
                <div class="login-field" style="max-width:300px;margin:8px auto 0">
                    <label>Confirm Password</label>
                    <input type="password" id="vaultConfirmPass" placeholder="confirm password"
                           onkeydown="if(event.key==='Enter') VaultModule.createVault()">
                </div>
                <button class="login-btn" style="max-width:300px;margin:16px auto 0;display:block" onclick="VaultModule.createVault()">Create Vault</button>
            </div>`;
    },

    showLogin(el) {
        el.innerHTML = `
            <div class="vault-center">
                <div class="vault-lock-icon">🔒</div>
                <h2>Unlock Vault</h2>
                <p style="color:var(--text-dim);margin:12px 0">Enter your vault password to access encrypted files</p>
                <div class="login-field" style="max-width:300px;margin:0 auto">
                    <label>Vault Password</label>
                    <input type="password" id="vaultPass" placeholder="vault password"
                           onkeydown="if(event.key==='Enter') VaultModule.unlock()">
                </div>
                <div class="login-error" id="vaultError" style="display:none;max-width:300px;margin:8px auto"></div>
                <button class="login-btn" style="max-width:300px;margin:16px auto 0;display:block" onclick="VaultModule.unlock()">Unlock</button>
            </div>`;
    },

    async createVault() {
        const pass = document.getElementById('vaultNewPass').value;
        const confirm = document.getElementById('vaultConfirmPass').value;
        if (pass !== confirm) { alert('Passwords do not match'); return; }
        if (pass.length < 4) { alert('Password must be 4+ characters'); return; }

        try {
            const res = await authFetch(`${API}/api/vault/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            this.vaultToken = data.token;
            this.unlocked = true;
            this.files = [];
            this.showVault();
        } catch (err) { alert('Failed to create vault: ' + err.message); }
    },

    async unlock() {
        const pass = document.getElementById('vaultPass').value;
        const errEl = document.getElementById('vaultError');

        try {
            const res = await authFetch(`${API}/api/vault/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass })
            });
            const data = await res.json();
            if (data.error) {
                errEl.textContent = data.error;
                errEl.style.display = 'block';
                return;
            }
            this.vaultToken = data.token;
            this.unlocked = true;
            this.files = data.files || [];
            this.showVault();
        } catch (err) {
            errEl.textContent = 'Connection error';
            errEl.style.display = 'block';
        }
    },

    showVault() {
        const el = document.getElementById('mod-vault');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">🔓 Vault</div>
                    <div class="module-subtitle">${this.files.length} encrypted files · AES-256-GCM</div>
                </div>
                <div style="display:flex;gap:8px">
                    <label class="btn btn-primary" style="cursor:pointer">
                        📤 Encrypt & Store
                        <input type="file" multiple style="display:none" onchange="VaultModule.storeFiles(this.files)">
                    </label>
                    <button class="btn" onclick="VaultModule.lock()">🔒 Lock</button>
                </div>
            </div>
            <div id="vaultFiles"></div>
        `;
        this.renderFiles();
    },

    renderFiles() {
        const el = document.getElementById('vaultFiles');
        if (this.files.length === 0) {
            el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔐</div><h3>Vault is empty</h3><p>Use "Encrypt & Store" to add files</p></div>`;
            return;
        }

        let html = '<div class="file-list">';
        this.files.forEach(f => {
            html += `
                <div class="file-row">
                    <span class="file-icon">🔒</span>
                    <span class="file-name">${escapeHtml(f.name)}</span>
                    <span class="file-size">${formatBytes(f.size)}</span>
                    <span class="file-date">${formatDate(f.date)}</span>
                    <div class="file-actions">
                        <button class="file-action-btn" data-vault-action="retrieve" data-file-id="${escapeHtml(f.id)}" data-file-name="${escapeHtml(f.name)}">⬇️</button>
                        <button class="file-action-btn" data-vault-action="delete" data-file-id="${escapeHtml(f.id)}" data-file-name="${escapeHtml(f.name)}">🗑</button>
                    </div>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    },

    async storeFiles(fileList) {
        for (const file of fileList) {
            try {
                const formData = new FormData();
                formData.append('file', file);

                await authFetch(`${API}/api/vault/store`, {
                    method: 'POST',
                    headers: {
                        'x-vault-token': this.vaultToken
                    },
                    body: formData
                    // Do NOT set Content-Type — browser sets it with boundary for FormData
                });
            } catch (err) {
                alert(`Failed to store ${file.name}: ${err.message}`);
            }
        }
        // Refresh
        await this.refreshFiles();
    },

    async retrieve(id, name) {
        try {
            const res = await authFetch(`${API}/api/vault/retrieve/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: this.vaultToken })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to download');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            // The anchor must be in the document and the object URL must
            // outlive the click, or the download is cancelled.
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) { alert('Retrieval failed: ' + err.message); }
    },

    async deleteFile(id, name) {
        if (!confirm(`Delete "${name}" from vault?`)) return;
        try {
            const res = await authFetch(`${API}/api/vault/${id}`, {
                method: 'DELETE',
                headers: { 'x-vault-token': this.vaultToken }
            });
            if (!res.ok) throw new Error((await res.json()).error);
            await this.refreshFiles();
        } catch (err) { alert('Delete failed: ' + err.message); }
    },

    async refreshFiles() {
        // Uses the unlock token rather than re-sending the password. The old
        // version referenced this.vaultPassword, which is never assigned
        // anywhere, so the list emptied itself after every store and delete.
        try {
            const res = await authFetch(`${API}/api/vault/files`, {
                headers: { 'x-vault-token': this.vaultToken }
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Could not list vault files');
            const data = await res.json();
            this.files = data.files || [];
            this.showVault();
        } catch (err) {
            alert('Could not refresh vault: ' + err.message);
        }
    },

    lock() {
        this.unlocked = false;
        this.vaultToken = null;
        this.files = [];
        this.init();
    }
};

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.VaultModule = VaultModule;
