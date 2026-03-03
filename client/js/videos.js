// ═══════════════════════════════════════════
// CyberDeck - Videos Module
// ═══════════════════════════════════════════

const VideosModule = {
    videos: [],
    folders: [],

    async init() {
        const el = document.getElementById('mod-videos');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Videos</div>
                    <div class="module-subtitle" id="videoCount">Loading...</div>
                </div>
                <div class="search-box">
                    <span class="search-icon">🔍</span>
                    <input type="text" placeholder="Search videos..." 
                           id="videoSearch" oninput="VideosModule.filter(this.value)">
                </div>
            </div>
            <div id="videosContent"><div class="loading-spinner"></div></div>
        `;
        await this.load();
    },

    async load() {
        try {
            const res = await authFetch(`${API}/api/videos`);
            const data = await res.json();
            this.videos = data.videos || [];
            this.folders = data.folders || [];
            this.filteredVideos = [...this.videos];
            document.getElementById('videoCount').textContent = `${this.videos.length} videos`;
            this.render();
        } catch (err) {
            document.getElementById('videosContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎬</div>
                    <h3>Video library unavailable</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    },

    filter(query) {
        const q = query.toLowerCase();
        this.filteredVideos = q
            ? this.videos.filter(v => v.name.toLowerCase().includes(q))
            : [...this.videos];
        this.render();
    },

    render() {
        const el = document.getElementById('videosContent');
        if (this.filteredVideos.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎬</div>
                    <h3>No videos found</h3>
                    <p>Add videos to your Movies directory</p>
                </div>`;
            return;
        }

        let html = '<div class="grid-list grid-3">';
        this.filteredVideos.forEach(video => {
            const name = video.name.replace(/\.[^/.]+$/, '');
            html += `
                <div class="video-card" onclick="VideosModule.playVideo('${video.id}', '${name.replace(/'/g, "\\'")}')">
                    <div class="video-thumb">
                        🎬
                        <div class="play-overlay"><span>▶</span></div>
                    </div>
                    <div class="video-info">
                        <div class="video-name">${name}</div>
                        <div class="video-meta">
                            <span class="tag tag-electric">${video.ext.toUpperCase()}</span>
                            · ${formatBytes(video.size)}
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    },

    playVideo(id, name) {
        const overlay = document.createElement('div');
        overlay.className = 'video-player-overlay';
        overlay.id = 'videoOverlay';
        const tokenParam = Auth.token ? `?token=${encodeURIComponent(Auth.token)}` : '';
        overlay.innerHTML = `
            <button class="close-btn" onclick="VideosModule.closePlayer()">✕</button>
            <video controls autoplay>
                <source src="${API}/api/videos/stream/${id}${tokenParam}" type="video/mp4">
                Your browser does not support video playback.
            </video>
        `;
        document.body.appendChild(overlay);

        // ESC to close
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this.closePlayer();
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    closePlayer() {
        const overlay = document.getElementById('videoOverlay');
        if (overlay) {
            const video = overlay.querySelector('video');
            if (video) video.pause();
            overlay.remove();
        }
        document.removeEventListener('keydown', this._keyHandler);
    }
};
