// ═══════════════════════════════════════════
// CyberDeck - File Manager Module
// ═══════════════════════════════════════════

const FilesModule = {
    currentPath: '',
    items: [],

    async init() {
        const el = document.getElementById('mod-files');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">File Manager</div>
                    <div class="module-subtitle" id="filesPath">/</div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn" onclick="FilesModule.createFolder()">📁 New Folder</button>
                    <label class="btn" style="cursor:pointer">
                        📤 Upload
                        <input type="file" multiple style="display:none" onchange="FilesModule.uploadFiles(this.files)">
                    </label>
                </div>
            </div>
            <div class="breadcrumb" id="breadcrumb"></div>
            <div id="filesContent"><div class="loading-spinner"></div></div>
        `;
        await this.browse('');
    },

    async browse(dirPath) {
        this.currentPath = dirPath;
        document.getElementById('filesContent').innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/files?path=${encodeURIComponent(dirPath)}`);
            const data = await res.json();

            this.items = data.items || [];
            document.getElementById('filesPath').textContent = '/' + (data.currentPath || '');

            // Build breadcrumb
            this.renderBreadcrumb(data.currentPath);
            this.render(data);
        } catch (err) {
            document.getElementById('filesContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📁</div>
                    <h3>Failed to load directory</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    },

    renderBreadcrumb(currentPath) {
        const el = document.getElementById('breadcrumb');
        let html = `<span class="breadcrumb-item" onclick="FilesModule.browse('')">🏠 Root</span>`;

        if (currentPath) {
            const parts = currentPath.split(/[/\\]/).filter(Boolean);
            let buildPath = '';
            parts.forEach((part, i) => {
                buildPath += (i > 0 ? '/' : '') + part;
                const p = buildPath;
                html += `<span class="breadcrumb-sep">›</span>`;
                html += `<span class="breadcrumb-item" onclick="FilesModule.browse('${p}')">${part}</span>`;
            });
        }
        el.innerHTML = html;
    },

    render(data) {
        const el = document.getElementById('filesContent');
        if (this.items.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📁</div>
                    <h3>Empty directory</h3>
                    <p>This folder has no files</p>
                </div>`;
            return;
        }

        let html = '<div class="file-list">';

        // Parent directory
        if (!data.isRoot) {
            html += `
                <div class="file-row" onclick="FilesModule.browse('${data.parentPath || ''}')">
                    <span class="file-icon">⬆️</span>
                    <span class="file-name">..</span>
                    <span class="file-size"></span>
                    <span class="file-date"></span>
                </div>`;
        }

        this.items.forEach(item => {
            const icon = getFileIcon(item.ext, item.isDirectory);
            const clickAction = item.isDirectory
                ? `FilesModule.browse('${item.path.replace(/\\/g, '/').replace(/'/g, "\\'")}')`
                : `FilesModule.previewFile('${item.path.replace(/\\/g, '/').replace(/'/g, "\\'")}', '${item.ext}')`;

            html += `
                <div class="file-row" onclick="${clickAction}">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${item.name}</span>
                    <span class="file-size">${item.sizeFormatted || ''}</span>
                    <span class="file-date">${item.modified ? formatDate(item.modified) : ''}</span>
                    <div class="file-actions">
                        ${!item.isDirectory ? `<button class="file-action-btn" onclick="event.stopPropagation(); FilesModule.download('${item.path.replace(/\\/g, '/').replace(/'/g, "\\'")}')">⬇</button>` : ''}
                        <button class="file-action-btn" onclick="event.stopPropagation(); FilesModule.deleteItem('${item.path.replace(/\\/g, '/').replace(/'/g, "\\'")}', '${item.name.replace(/'/g, "\\'")}')">🗑</button>
                    </div>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    },

    download(filePath) {
        const token = Auth.token ? `&token=${encodeURIComponent(Auth.token)}` : '';
        window.open(`${API}/api/files/download?path=${encodeURIComponent(filePath)}${token}`, '_blank');
    },

    previewFile(filePath, ext) {
        const previewExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mp3', 'flac', 'ogg', 'wav', 'pdf', 'txt', 'json', 'html', 'css', 'js'];
        if (!previewExts.includes(ext)) {
            this.download(filePath);
            return;
        }

        const token = Auth.token ? `&token=${encodeURIComponent(Auth.token)}` : '';
        const url = `${API}/api/files/preview?path=${encodeURIComponent(filePath)}${token}`;
        const overlay = document.createElement('div');
        overlay.className = 'video-player-overlay';
        overlay.id = 'filePreview';
        overlay.style.cursor = 'default';

        let content = '';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
            content = `<img src="${url}" style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:8px">`;
        } else if (['mp4', 'webm'].includes(ext)) {
            content = `<video controls autoplay src="${url}" style="max-width:95vw;max-height:85vh;border-radius:8px"></video>`;
        } else if (['mp3', 'flac', 'ogg', 'wav'].includes(ext)) {
            content = `<div style="text-align:center"><h3 style="margin-bottom:20px;color:var(--cyan)">${filePath.split('/').pop()}</h3><audio controls autoplay src="${url}"></audio></div>`;
        } else if (ext === 'pdf') {
            content = `<iframe src="${url}" style="width:90vw;height:85vh;border:none;border-radius:8px;background:white"></iframe>`;
        } else {
            content = `<iframe src="${url}" style="width:80vw;height:80vh;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"></iframe>`;
        }

        overlay.innerHTML = `
            <button class="close-btn" onclick="FilesModule.closePreview()">✕</button>
            ${content}
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePreview();
        });
        document.body.appendChild(overlay);

        this._keyHandler = (e) => { if (e.key === 'Escape') this.closePreview(); };
        document.addEventListener('keydown', this._keyHandler);
    },

    closePreview() {
        const el = document.getElementById('filePreview');
        if (el) {
            const media = el.querySelector('video, audio');
            if (media) media.pause();
            el.remove();
        }
        document.removeEventListener('keydown', this._keyHandler);
    },

    async deleteItem(filePath, name) {
        if (!confirm(`Delete "${name}"?`)) return;
        try {
            await authFetch(`${API}/api/files?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
            await this.browse(this.currentPath);
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    },

    async createFolder() {
        const name = prompt('New folder name:');
        if (!name) return;
        const newPath = this.currentPath ? `${this.currentPath}/${name}` : name;
        try {
            await authFetch(`${API}/api/files/mkdir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newPath })
            });
            await this.browse(this.currentPath);
        } catch (err) {
            alert('Create folder failed: ' + err.message);
        }
    },

    async uploadFiles(fileList) {
        if (!fileList.length) return;
        const formData = new FormData();
        formData.append('path', this.currentPath);
        for (const file of fileList) {
            formData.append('files', file);
        }
        try {
            await authFetch(`${API}/api/files/upload`, {
                method: 'POST',
                body: formData,
                // Note: do NOT set Content-Type header — browser sets it with boundary for FormData
            });
            await this.browse(this.currentPath);
        } catch (err) {
            alert('Upload failed: ' + err.message);
        }
    }
};
