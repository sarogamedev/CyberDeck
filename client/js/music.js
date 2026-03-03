// ═══════════════════════════════════════════
// CyberDeck - Music Module
// ═══════════════════════════════════════════

const MusicModule = {
    tracks: [],
    albums: [],
    filteredTracks: [],

    async init() {
        const el = document.getElementById('mod-music');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Music</div>
                    <div class="module-subtitle" id="musicCount">Loading library...</div>
                </div>
                <div class="search-box">
                    <span class="search-icon">🔍</span>
                    <input type="text" placeholder="Search tracks, artists, albums..." 
                           id="musicSearch" oninput="MusicModule.filter(this.value)">
                </div>
            </div>
            <div id="musicContent"><div class="loading-spinner"></div></div>
        `;
        await this.load();
    },

    async load() {
        try {
            const res = await authFetch(`${API}/api/music`);
            const data = await res.json();
            this.tracks = data.tracks || [];
            this.albums = data.albums || [];
            this.filteredTracks = [...this.tracks];
            document.getElementById('musicCount').textContent =
                `${this.tracks.length} tracks · ${this.albums.length} albums`;
            this.render();
        } catch (err) {
            document.getElementById('musicContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎵</div>
                    <h3>Music library unavailable</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    },

    filter(query) {
        const q = query.toLowerCase();
        this.filteredTracks = q
            ? this.tracks.filter(t =>
                (t.title || '').toLowerCase().includes(q) ||
                (t.artist || '').toLowerCase().includes(q) ||
                (t.album || '').toLowerCase().includes(q))
            : [...this.tracks];
        this.render();
    },

    render() {
        const el = document.getElementById('musicContent');
        if (this.filteredTracks.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎵</div>
                    <h3>No tracks found</h3>
                    <p>Add music files to your music directory</p>
                </div>`;
            return;
        }

        let html = '<div class="track-list">';
        this.filteredTracks.forEach((track, i) => {
            const playing = MusicPlayer.currentTrack?.id === track.id;
            html += `
                <div class="track-row ${playing ? 'playing' : ''}" onclick="MusicPlayer.play(${i}, MusicModule.filteredTracks)">
                    <span class="track-num">${playing ? '▶' : i + 1}</span>
                    <div class="track-info">
                        <div class="track-name">${track.title || track.name}</div>
                        <div class="track-artist-album">${track.artist || ''} ${track.album ? '· ' + track.album : ''}</div>
                    </div>
                    <span class="tag tag-cyan track-format">${track.format || track.ext}</span>
                    <span class="track-duration">${formatDuration(track.duration)}</span>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    }
};

// ═══════════════════════════════════════════
// Music Player Controller
// ═══════════════════════════════════════════

const MusicPlayer = {
    audio: null,
    currentTrack: null,
    playlist: [],
    currentIndex: -1,
    isPlaying: false,

    init() {
        this.audio = document.getElementById('audioElement');
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('ended', () => this.next());
        this.audio.addEventListener('loadedmetadata', () => {
            document.getElementById('playerDuration').textContent =
                formatDuration(this.audio.duration);
        });
    },

    play(index, playlist) {
        if (playlist) this.playlist = playlist;
        if (index < 0 || index >= this.playlist.length) return;

        this.currentIndex = index;
        this.currentTrack = this.playlist[index];

        this.audio.src = `${API}/api/music/stream/${this.currentTrack.id}`;
        this.audio.play();
        this.isPlaying = true;

        // Update player bar
        const bar = document.getElementById('playerBar');
        bar.style.display = 'flex';
        document.getElementById('playerTitle').textContent = this.currentTrack.title || this.currentTrack.name;
        document.getElementById('playerArtist').textContent = this.currentTrack.artist || '';
        document.getElementById('playBtn').textContent = '⏸';

        // Update cover
        const coverEl = document.getElementById('playerCover');
        if (this.currentTrack.hasCover) {
            coverEl.innerHTML = `<img src="${API}/api/music/cover/${this.currentTrack.id}" alt="cover">`;
        } else {
            coverEl.innerHTML = '🎵';
        }

        // Add player padding to current module
        document.querySelectorAll('.module').forEach(m => m.classList.add('has-player'));

        // Re-render music list to show playing state
        if (currentModule === 'music') MusicModule.render();
    },

    toggle() {
        if (!this.currentTrack) return;
        if (this.isPlaying) {
            this.audio.pause();
            this.isPlaying = false;
            document.getElementById('playBtn').textContent = '▶';
        } else {
            this.audio.play();
            this.isPlaying = true;
            document.getElementById('playBtn').textContent = '⏸';
        }
    },

    next() {
        if (this.currentIndex < this.playlist.length - 1) {
            this.play(this.currentIndex + 1);
        }
    },

    prev() {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
        } else if (this.currentIndex > 0) {
            this.play(this.currentIndex - 1);
        }
    },

    seek(event) {
        const bar = document.getElementById('playerProgress');
        const rect = bar.getBoundingClientRect();
        const pct = (event.clientX - rect.left) / rect.width;
        this.audio.currentTime = pct * this.audio.duration;
    },

    setVolume(val) {
        this.audio.volume = val;
        const icon = val == 0 ? '🔇' : val < 0.5 ? '🔉' : '🔊';
        document.querySelector('.vol-icon').textContent = icon;
    },

    toggleMute() {
        this.audio.muted = !this.audio.muted;
        document.querySelector('.vol-icon').textContent = this.audio.muted ? '🔇' : '🔊';
        document.getElementById('volSlider').value = this.audio.muted ? 0 : this.audio.volume;
    },

    updateProgress() {
        if (!this.audio.duration) return;
        const pct = (this.audio.currentTime / this.audio.duration) * 100;
        document.getElementById('playerProgressFill').style.width = pct + '%';
        document.getElementById('playerCurrentTime').textContent = formatDuration(this.audio.currentTime);
    }
};

// Init player when DOM loaded
document.addEventListener('DOMContentLoaded', () => MusicPlayer.init());
