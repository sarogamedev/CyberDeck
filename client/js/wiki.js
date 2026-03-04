// ═══════════════════════════════════════════
// CyberDeck - Wikipedia Module
// ═══════════════════════════════════════════

const WikiModule = {
    async init() {
        const el = document.getElementById('mod-wiki');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Wikipedia</div>
                    <div class="module-subtitle" id="wikiStatus">Offline Encyclopedia</div>
                </div>
            </div>
            <div style="max-width: 600px; margin: 0 auto;">
                <div class="search-box" style="max-width: 100%; margin-bottom: 24px;">
                    <span class="search-icon">🔍</span>
                    <input type="text" placeholder="Search Wikipedia..." 
                           id="wikiSearch" onkeydown="if(event.key==='Enter') WikiModule.search(this.value)">
                </div>
            </div>
            <div id="wikiContent">
                <div class="empty-state">
                    <div class="empty-icon">📚</div>
                    <h3>Search Wikipedia</h3>
                    <p>Type a query above and press Enter to search the offline encyclopedia</p>
                </div>
            </div>
        `;
        await this.checkStatus();
    },

    async checkStatus() {
        try {
            const res = await authFetch(`${API}/api/wiki/status`);
            const data = await res.json();
            document.getElementById('wikiStatus').textContent =
                data.running ? 'Kiwix running ✓' : 'Kiwix not running — start from Admin Panel';
        } catch (e) {
            document.getElementById('wikiStatus').textContent = 'Cannot connect';
        }
    },

    async search(query) {
        if (!query.trim()) return;
        const el = document.getElementById('wikiContent');
        el.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/wiki/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();

            if (!data.results || data.results.length === 0) {
                el.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">🔍</div>
                        <h3>No results</h3>
                        <p>No articles found for "${query}"</p>
                    </div>`;
                return;
            }

            let html = '<ul class="wiki-results">';
            data.results.forEach(result => {
                html += `
                    <li class="wiki-result-item" onclick="WikiModule.loadArticle('${result.path.replace(/'/g, "\\'")}')">
                        <strong>${result.title}</strong>
                    </li>`;
            });
            html += '</ul>';
            el.innerHTML = html;
        } catch (err) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <h3>Search failed</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    },

    async loadArticle(path) {
        const el = document.getElementById('wikiContent');
        el.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/wiki/article/${path}`);
            const data = await res.json();

            el.innerHTML = `
                <button class="btn" onclick="WikiModule.init()" style="margin-bottom: 16px">← Back to search</button>
                <div class="wiki-article">${data.html}</div>
            `;

            const articleEl = el.querySelector('.wiki-article');
            const apiBase = API || window.location.origin;
            const reqBaseUrl = new URL(`${apiBase}/api/wiki/asset/${path}`);
            const linkBaseUrl = new URL(`${apiBase}/api/wiki/article/${path}`);

            articleEl.querySelectorAll('img, source, link[rel="stylesheet"]').forEach(node => {
                const attr = node.tagName === 'LINK' ? 'href' : 'src';
                let val = node.getAttribute(attr);
                if (!val || val.startsWith('http') || val.startsWith('data:')) return;

                if (val.startsWith('/')) {
                    // Root absolute path from kiwix-serve
                    node.setAttribute(attr, `${apiBase}/api/wiki/asset${val}`);
                } else {
                    // Relative ZIM path (like ../I/m/math.png)
                    const resolved = new URL(val, reqBaseUrl);
                    node.setAttribute(attr, resolved.href);
                }
            });

            // Strip out annoying LaTeX fallback text that leaks on mobile/broken images
            articleEl.querySelectorAll('.mwe-math-fallback-source-inline, .mwe-math-fallback-source-display').forEach(node => {
                node.remove(); // Nuke the raw LaTeX from the DOM completely
            });

            // Make math fallback images visible but unstyled if they lack an explicit class
            articleEl.querySelectorAll('img.mwe-math-fallback-image-inline').forEach(node => {
                node.style.display = 'inline-block';
                node.style.verticalAlign = 'middle';
            });

            // Make internal links work and intercept clicks
            articleEl.querySelectorAll('a').forEach(a => {
                let val = a.getAttribute('href');
                if (!val || val.startsWith('http') || val.startsWith('javascript:') || val.startsWith('#')) return;

                let finalUrl;
                if (val.startsWith('/')) {
                    finalUrl = `${apiBase}/api/wiki/article${val}`;
                } else {
                    const resolved = new URL(val, linkBaseUrl);
                    finalUrl = resolved.href;
                }

                a.setAttribute('href', finalUrl);

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Intercept and route internally
                    const destUrl = new URL(finalUrl);
                    const destPathSplit = destUrl.pathname.split('/api/wiki/article/');
                    if (destPathSplit.length > 1) {
                        const nextPath = destPathSplit[1];
                        WikiModule.loadArticle(nextPath + destUrl.search + destUrl.hash);
                    }
                });
            });
        } catch (err) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <h3>Failed to load article</h3>
                    <p>${err.message}</p>
                </div>`;
        }
    }
};
