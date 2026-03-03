// ═══════════════════════════════════════════
// CyberDeck - Ebook Module
// ═══════════════════════════════════════════

const EbooksModule = {
    books: [],
    currentBook: null,
    rendition: null,

    async init() {
        const el = document.getElementById('mod-ebooks');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Ebooks</div>
                    <div class="module-subtitle" id="ebookCount">Loading library...</div>
                </div>
                <div class="search-box">
                    <span class="search-icon">🔍</span>
                    <input type="text" placeholder="Search ebooks..." 
                           id="ebookSearch" oninput="EbooksModule.filter(this.value)">
                </div>
            </div>
            <div id="ebooksContent"><div class="loading-spinner"></div></div>
        `;
        await this.load();
    },

    async load() {
        try {
            const res = await authFetch(`${API}/api/ebooks`);
            const data = await res.json();
            this.books = data.books || [];
            this.filteredBooks = [...this.books];
            document.getElementById('ebookCount').textContent = `${this.books.length} books`;
            this.render();
        } catch (err) {
            document.getElementById('ebooksContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📖</div>
                    <h3>Ebook library unavailable</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    },

    filter(query) {
        const q = query.toLowerCase();
        this.filteredBooks = q
            ? this.books.filter(b => b.title.toLowerCase().includes(q) || b.name.toLowerCase().includes(q))
            : [...this.books];
        this.render();
    },

    render() {
        const el = document.getElementById('ebooksContent');
        if (this.filteredBooks.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📖</div>
                    <h3>No ebooks found</h3>
                    <p>Add EPUB or PDF files to your Books directory</p>
                </div>`;
            return;
        }

        let html = '<div class="grid-list grid-4">';
        this.filteredBooks.forEach(book => {
            const formatColor = book.format === 'EPUB' ? 'tag-green' : book.format === 'PDF' ? 'tag-magenta' : 'tag-cyan';
            html += `
                <div class="book-card" onclick="EbooksModule.openBook('${book.id}', '${book.title.replace(/'/g, "\\'")}', '${book.ext}')">
                    <div class="book-cover">📖</div>
                    <div class="book-title">${book.title}</div>
                    <div class="book-format">
                        <span class="tag ${formatColor}">${book.format}</span>
                        · ${formatBytes(book.size)}
                    </div>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    },

    openBook(id, title, ext) {
        const tokenParam = Auth.token ? `?token=${encodeURIComponent(Auth.token)}` : '';
        if (ext === 'epub' && typeof ePub !== 'undefined') {
            this.openEpub(id, title, tokenParam);
        } else if (ext === 'pdf') {
            this.openPdf(id, title, tokenParam);
        } else {
            // Fallback: download
            window.open(`${API}/api/ebooks/read/${id}${tokenParam}`, '_blank');
        }
    },

    openEpub(id, title, tokenParam) {
        const overlay = document.createElement('div');
        overlay.className = 'reader-overlay';
        overlay.id = 'readerOverlay';
        overlay.innerHTML = `
            <div class="reader-toolbar">
                <button class="back-btn" onclick="EbooksModule.closeReader()">← </button>
                <span class="book-reading-title">${title}</span>
                <button class="btn" onclick="EbooksModule.prevPage()">◀ Prev</button>
                <button class="btn" onclick="EbooksModule.nextPage()">Next ▶</button>
            </div>
            <div class="reader-content" id="readerContent"></div>
        `;
        document.body.appendChild(overlay);

        try {
            const book = ePub(`${API}/api/ebooks/read/${id}${tokenParam}`);
            this.rendition = book.renderTo('readerContent', {
                width: '100%',
                height: '100%',
                spread: 'none'
            });
            this.rendition.display();
        } catch (err) {
            document.getElementById('readerContent').innerHTML = `
                <div class="empty-state" style="padding-top:100px">
                    <h3>Failed to open EPUB</h3>
                    <p>${err.message}</p>
                </div>`;
        }

        // Keyboard
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this.closeReader();
            if (e.key === 'ArrowLeft') this.prevPage();
            if (e.key === 'ArrowRight') this.nextPage();
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    openPdf(id, title, tokenParam) {
        const overlay = document.createElement('div');
        overlay.className = 'reader-overlay';
        overlay.id = 'readerOverlay';
        overlay.innerHTML = `
            <div class="reader-toolbar">
                <button class="back-btn" onclick="EbooksModule.closeReader()">←</button>
                <span class="book-reading-title">${title}</span>
            </div>
            <div class="reader-content">
                <iframe src="${API}/api/ebooks/read/${id}${tokenParam}" title="${title}"></iframe>
            </div>
        `;
        document.body.appendChild(overlay);

        this._keyHandler = (e) => { if (e.key === 'Escape') this.closeReader(); };
        document.addEventListener('keydown', this._keyHandler);
    },

    prevPage() {
        if (this.rendition) this.rendition.prev();
    },

    nextPage() {
        if (this.rendition) this.rendition.next();
    },

    closeReader() {
        const overlay = document.getElementById('readerOverlay');
        if (overlay) overlay.remove();
        this.rendition = null;
        document.removeEventListener('keydown', this._keyHandler);
    }
};
