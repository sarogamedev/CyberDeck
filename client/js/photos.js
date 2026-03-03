// ═══════════════════════════════════════════
// CyberDeck - Photos Module
// ═══════════════════════════════════════════

const PhotosModule = {
    photos: [],
    groups: [],
    currentLightbox: -1,

    async init() {
        const el = document.getElementById('mod-photos');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Photos</div>
                    <div class="module-subtitle" id="photoCount">Loading...</div>
                </div>
            </div>
            <div id="photosContent"><div class="loading-spinner"></div></div>
        `;
        await this.load();
    },

    async load() {
        try {
            const res = await authFetch(`${API}/api/photos`);
            const data = await res.json();
            this.photos = data.photos || [];
            this.groups = data.groups || [];
            document.getElementById('photoCount').textContent = `${this.photos.length} photos`;
            this.render();
        } catch (err) {
            document.getElementById('photosContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📸</div>
                    <h3>Photo library unavailable</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    },

    render() {
        const el = document.getElementById('photosContent');
        if (this.photos.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📸</div>
                    <h3>No photos found</h3>
                    <p>Add photos to your DCIM directory</p>
                </div>`;
            return;
        }

        let html = '';
        this.groups.forEach(group => {
            html += `<div class="date-group-header">${group.date} · ${group.count} photos</div>`;
            html += '<div class="photo-grid">';
            group.photos.forEach(photo => {
                const idx = this.photos.findIndex(p => p.id === photo.id);
                html += `
                    <div class="photo-item" onclick="PhotosModule.openLightbox(${idx})">
                        <img src="${API}/api/photos/thumb/${photo.id}" 
                             alt="${photo.name}" loading="lazy"
                             onerror="this.parentElement.innerHTML='🖼️'">
                    </div>`;
            });
            html += '</div>';
        });
        el.innerHTML = html;
    },

    openLightbox(index) {
        this.currentLightbox = index;
        const photo = this.photos[index];
        const overlay = document.createElement('div');
        overlay.className = 'lightbox';
        overlay.id = 'lightbox';
        overlay.innerHTML = `
            <button class="lightbox-close" onclick="PhotosModule.closeLightbox()">✕</button>
            <button class="lightbox-nav prev" onclick="event.stopPropagation(); PhotosModule.lightboxPrev()">‹</button>
            <img src="${API}/api/photos/full/${photo.id}" alt="${photo.name}">
            <button class="lightbox-nav next" onclick="event.stopPropagation(); PhotosModule.lightboxNext()">›</button>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeLightbox();
        });
        document.body.appendChild(overlay);

        // Keyboard navigation
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this.closeLightbox();
            if (e.key === 'ArrowLeft') this.lightboxPrev();
            if (e.key === 'ArrowRight') this.lightboxNext();
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    closeLightbox() {
        const lb = document.getElementById('lightbox');
        if (lb) lb.remove();
        document.removeEventListener('keydown', this._keyHandler);
    },

    lightboxPrev() {
        if (this.currentLightbox > 0) {
            this.closeLightbox();
            this.openLightbox(this.currentLightbox - 1);
        }
    },

    lightboxNext() {
        if (this.currentLightbox < this.photos.length - 1) {
            this.closeLightbox();
            this.openLightbox(this.currentLightbox + 1);
        }
    }
};
