// ═══════════════════════════════════════════
// CyberDeck - Survival Knowledge Library
// ═══════════════════════════════════════════

const SurvivalModule = {
    categories: [],

    async init() {
        const el = document.getElementById('mod-survival');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Survival Library</div>
                    <div class="module-subtitle" id="survCount">Loading knowledge base...</div>
                </div>
                <div class="search-box">
                    <span class="search-icon">🔍</span>
                    <input type="text" placeholder="Search survival guides..."
                           id="survSearch" onkeydown="if(event.key==='Enter') SurvivalModule.search(this.value)">
                </div>
            </div>
            <div id="survContent"><div class="loading-spinner"></div></div>
        `;

        delegate(document.getElementById('mod-survival'), '[data-survival-category],[data-survival-article]', (el) => {
            if (el.dataset.survivalCategory) SurvivalModule.showCategory(el.dataset.survivalCategory);
            else SurvivalModule.readArticle(el.dataset.survivalArticle);
        });

        await this.load();
    },

    async load() {
        try {
            const res = await authFetch(`${API}/api/survival`);
            const data = await res.json();
            this.categories = data.categories || [];
            document.getElementById('survCount').textContent = `${data.total} articles in ${this.categories.length} categories`;
            this.renderCategories();
        } catch (err) {
            document.getElementById('survContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📖</div>
                    <h3>Knowledge base unavailable</h3>
                    <p>${escapeHtml(err.message)}</p>
                </div>`;
        }
    },

    renderCategories() {
        const el = document.getElementById('survContent');
        if (this.categories.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📖</div>
                    <h3>No survival content</h3>
                    <p>Add markdown files to server/content/survival/</p>
                </div>`;
            return;
        }

        let html = '<div class="surv-grid">';
        this.categories.forEach(cat => {
            html += `
                <div class="surv-category card" data-survival-category="${escapeHtml(cat.name)}">
                    <div class="surv-cat-icon">${escapeHtml(cat.icon)}</div>
                    <div class="surv-cat-name">${escapeHtml(cat.label)}</div>
                    <div class="surv-cat-count">${cat.articles.length} article${cat.articles.length > 1 ? 's' : ''}</div>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    },

    showCategory(catName) {
        const cat = this.categories.find(c => c.name === catName);
        if (!cat) return;

        const el = document.getElementById('survContent');
        let html = `
            <button class="btn" onclick="SurvivalModule.renderCategories()" style="margin-bottom:16px">← All Categories</button>
            <h2 style="font-size:20px;margin-bottom:16px">${escapeHtml(cat.icon)} ${escapeHtml(cat.label)}</h2>
            <div class="article-list">`;

        cat.articles.forEach(article => {
            html += `
                <div class="article-item" data-survival-article="${escapeHtml(article.id)}">
                    <span class="article-icon">📄</span>
                    <div class="article-info">
                        <div class="article-title">${escapeHtml(article.title)}</div>
                        <div class="article-meta">${escapeHtml(formatBytes(article.size))}</div>
                    </div>
                </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
    },

    async readArticle(id) {
        const el = document.getElementById('survContent');
        el.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/survival/article/${id}`);
            const data = await res.json();

            // Simple markdown rendering
            let html = this.renderMarkdown(data.content);

            el.innerHTML = `
                <button class="btn" onclick="SurvivalModule.renderCategories()" style="margin-bottom:16px">← Back</button>
                <div class="article-reader">${html}</div>
            `;
        } catch (err) {
            el.innerHTML = `<div class="empty-state"><h3>Failed to load article</h3><p>${escapeHtml(err.message)}</p></div>`;
        }
    },

    async search(query) {
        if (!query.trim()) { this.renderCategories(); return; }
        const el = document.getElementById('survContent');
        el.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const res = await authFetch(`${API}/api/survival/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();

            if (data.results.length === 0) {
                el.innerHTML = `<div class="empty-state"><h3>No results for "${escapeHtml(query)}"</h3></div>`;
                return;
            }

            let html = `<button class="btn" onclick="SurvivalModule.renderCategories()" style="margin-bottom:16px">← Back</button>
                        <h3 style="margin-bottom:16px">${data.results.length} results for "${escapeHtml(query)}"</h3>
                        <div class="article-list">`;
            data.results.forEach(r => {
                html += `
                    <div class="article-item" data-survival-article="${escapeHtml(r.id)}">
                        <span class="article-icon">📄</span>
                        <div class="article-info">
                            <div class="article-title">${escapeHtml(r.title)}</div>
                            <div class="article-meta">${escapeHtml(r.category)} · ${escapeHtml(r.snippet)}</div>
                        </div>
                    </div>`;
            });
            html += '</div>';
            el.innerHTML = html;
        } catch (err) {
            el.innerHTML = `<div class="empty-state"><h3>Search failed</h3></div>`;
        }
    },

    renderMarkdown(md) {
        // Escape first, then apply markdown. Without this the renderer passed
        // raw HTML from the article through verbatim (table cells especially),
        // so any markup in a content file executed on the app origin.
        // llm.js:renderMarkdown already used this order; survival did not.
        return String(md == null ? '' : md)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/```[\s\S]*?```/g, (match) => {
                const code = match.replace(/```\w*\n?/g, '').replace(/```/g, '');
                return `<pre><code>${code}</code></pre>`;
            })
            .replace(/^\- (.+)$/gm, '<li>$1</li>')
            .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
            .replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>')
            // Table rendering (block-level parsing)
            .replace(/((?:\|.+\|\s*\n)+)/g, (match) => {
                const lines = match.trim().split('\n');
                if (lines.length < 2) return match;

                let headerIndex = -1;
                let separatorIndex = -1;

                // Find separator row (e.g., |---| or | :--- |)
                for (let i = 0; i < lines.length; i++) {
                    const cells = lines[i].split('|').filter(c => c.trim().length > 0);
                    if (cells.length > 0 && cells.every(c => /^[-:\s]+$/.test(c))) {
                        separatorIndex = i;
                        headerIndex = i - 1;
                        break;
                    }
                }

                if (separatorIndex === -1) {
                    // No separator found, treat all as regular rows or a malformed table
                    const rows = lines.map(line => {
                        const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                        return `<tr>${cells.map(c => `<td>${c.trim()}</td>`).join('')}</tr>`;
                    });
                    return `<table>${rows.join('')}</table>`;
                }

                const rows = [];
                for (let i = 0; i < lines.length; i++) {
                    if (i === separatorIndex) continue;

                    const cells = lines[i].split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                    const tag = (i === headerIndex) ? 'th' : 'td';
                    rows.push(`<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`);
                }

                return `<table>${rows.join('')}</table>`;
            })
            .replace(/^([^<\n].+)$/gm, '<p>$1</p>')
            .replace(/✅/g, '<span style="color:var(--green)">✅</span>')
            .replace(/❌/g, '<span style="color:var(--red)">❌</span>')
            .replace(/⚠️/g, '<span style="color:var(--yellow)">⚠️</span>');
    }
};

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.SurvivalModule = SurvivalModule;
