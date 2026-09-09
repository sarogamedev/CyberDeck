// ═══════════════════════════════════════════
// CyberDeck Client - App Controller + Auth
// ═══════════════════════════════════════════

const API = window.location.origin;
let currentModule = 'dashboard';
let sidebarCollapsed = false;

// Escape for interpolation into HTML.
//
// The previous implementation set textContent and read back innerHTML, which
// escapes only & < > and leaves quotes intact. Roughly two dozen call sites
// interpolate the result *inside an HTML attribute*, so a value containing a
// quote broke out of the attribute and executed. Escape quotes and slash too.
const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

window.escapeHtml = function (text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"'`=/]/g, (c) => HTML_ESCAPES[c]);
};

/** Escape for interpolation into a JavaScript single-quoted string literal. */
window.escapeJs = function (text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/</g, '\\u003C')
        .replace(/>/g, '\\u003E');
};

/**
 * Attach one delegated click listener to a module container.
 *
 * Remote-derived values (filenames, peer IPs, catalog ids, article paths) are
 * carried in data-* attributes and read back here, instead of being
 * interpolated into inline onclick markup where a quote breaks out into script.
 *
 * @param {HTMLElement} root Module container.
 * @param {(el: HTMLElement, e: Event) => void} handler Receives the matched element.
 * @param {string} selector Attribute selector identifying actionable elements.
 */
window.delegate = function (root, selector, handler) {
    if (!root || root.dataset.delegated === selector) return;
    root.dataset.delegated = selector;
    root.addEventListener('click', (e) => {
        const el = e.target.closest(selector);
        if (el && root.contains(el)) handler(el, e);
    });
};

/**
 * Sanitize untrusted HTML before it goes into innerHTML.
 *
 * Wikipedia/Kiwix article bodies are rendered as HTML by design, and a
 * downloaded ZIM file is not a trusted input. innerHTML does not run <script>,
 * but it does run <img onerror>, <svg onload>, javascript: URLs and friends,
 * which is enough to read the session token out of localStorage.
 *
 * Parses into an inert document, then walks it with an element and attribute
 * allowlist. Anything not listed is dropped.
 */
const SANITIZE_ALLOWED_TAGS = new Set([
    'A', 'ABBR', 'ARTICLE', 'ASIDE', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE',
    'CODE', 'COL', 'COLGROUP', 'DD', 'DEL', 'DFN', 'DIV', 'DL', 'DT', 'EM',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'I', 'IMG', 'INS', 'KBD', 'LI', 'MAIN', 'MARK', 'NAV', 'OL',
    'P', 'PRE', 'Q', 'S', 'SAMP', 'SECTION', 'SMALL', 'SPAN', 'STRONG', 'SUB',
    'SUMMARY', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TIME',
    'TR', 'U', 'UL', 'VAR', 'WBR', 'DETAILS', 'PICTURE', 'SOURCE'
]);

const SANITIZE_ALLOWED_ATTRS = new Set([
    'href', 'src', 'srcset', 'alt', 'title', 'colspan', 'rowspan', 'class',
    'id', 'lang', 'dir', 'width', 'height', 'datetime', 'cite', 'span'
]);

const SAFE_URL_RE = /^(https?:|mailto:|\/|\.\/|\.\.\/|#|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i;

window.sanitizeHtml = function (dirty) {
    if (!dirty) return '';
    const doc = new DOMParser().parseFromString(String(dirty), 'text/html');

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const doomed = [];

    while (walker.nextNode()) {
        const node = walker.currentNode;

        if (!SANITIZE_ALLOWED_TAGS.has(node.tagName)) {
            doomed.push(node);
            continue;
        }

        for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            // Drops every on* handler, plus style (expression/url tricks).
            if (!SANITIZE_ALLOWED_ATTRS.has(name)) {
                node.removeAttribute(attr.name);
                continue;
            }
            if ((name === 'href' || name === 'src') && !SAFE_URL_RE.test(attr.value.trim())) {
                node.removeAttribute(attr.name);
            }
        }

        if (node.tagName === 'A') {
            node.setAttribute('rel', 'noopener noreferrer');
        }
    }

    // Unwrap disallowed elements rather than deleting their text content,
    // except for ones whose content is never displayable markup.
    for (const node of doomed) {
        if (!node.parentNode) continue;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT',
             'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'SVG',
             'MATH', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName)) {
            node.remove();
        } else {
            node.replaceWith(...Array.from(node.childNodes));
        }
    }

    return doc.body.innerHTML;
};

/**
 * Transient toast. music.js called a showNotification that was never defined,
 * so a successful resync threw a ReferenceError inside its try block and the
 * catch handler then threw again on the same missing function.
 *
 * @param {string} message Text to show.
 * @param {'info'|'error'|'success'} kind Visual treatment.
 */
window.showNotification = function (message, kind = 'info') {
    let host = document.getElementById('toastHost');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toastHost';
        host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;' +
            'display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(host);
    }

    const colors = { info: 'var(--cyan)', error: 'var(--red)', success: 'var(--green)' };
    const toast = document.createElement('div');
    toast.textContent = String(message);
    toast.style.cssText = 'background:var(--surface2,#222);color:var(--text,#eee);' +
        'padding:10px 14px;border-radius:6px;font-size:13px;max-width:320px;' +
        'border-left:3px solid ' + (colors[kind] || colors.info) + ';' +
        'box-shadow:0 4px 12px rgba(0,0,0,.35);opacity:0;transition:opacity .2s;';
    host.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
    }, kind === 'error' ? 6000 : 3000);
};

/**
 * Short-lived, read-only token for URLs that media elements load directly
 * (<img>, <audio>, <video>, <iframe>), which cannot send an auth header.
 *
 * Replaces putting the full session token in the query string, where it ended
 * up in server access logs, browser history and Referer headers, and made every
 * GET route reachable cross-site.
 */
const MediaAuth = {
    token: null,
    expiresAt: 0,
    inFlight: null,

    /** Fetch or reuse a media token. Returns '' if one cannot be obtained. */
    async get() {
        if (this.token && Date.now() < this.expiresAt - 60000) return this.token;
        if (this.inFlight) return this.inFlight;

        this.inFlight = (async () => {
            try {
                const res = await authFetch(`${API}/api/auth/media-token`, { method: 'POST' });
                if (!res.ok) throw new Error('media token request failed');
                const data = await res.json();
                this.token = data.token;
                this.expiresAt = Date.now() + (data.expiresIn || 3600000);
                return this.token;
            } catch (err) {
                console.warn('[MediaAuth] Could not obtain media token:', err.message);
                return '';
            } finally {
                this.inFlight = null;
            }
        })();
        return this.inFlight;
    },

    /** Query-string fragment ('?token=...' or '') for a media URL. */
    async param() {
        const token = await this.get();
        return token ? `?token=${encodeURIComponent(token)}` : '';
    },

    clear() {
        this.token = null;
        this.expiresAt = 0;
    }
};
window.MediaAuth = MediaAuth;

// ═══════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════

const Auth = {
    token: localStorage.getItem('cyberdeck_token') || null,
    user: JSON.parse(localStorage.getItem('cyberdeck_user') || 'null'),

    async login() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');

        if (!username || !password) {
            errorEl.textContent = 'Please enter both username and password';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const res = await fetch(`${API}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok) {
                errorEl.textContent = data.error || 'Login failed';
                errorEl.style.display = 'block';
                return;
            }

            // Store session
            Auth.token = data.token;
            Auth.user = data.user;
            localStorage.setItem('cyberdeck_token', data.token);
            localStorage.setItem('cyberdeck_user', JSON.stringify(data.user));

            // Hide login, show app
            Auth.showApp();
        } catch (err) {
            errorEl.textContent = 'Cannot connect to server';
            errorEl.style.display = 'block';
        }
    },

    async checkSession() {
        if (!Auth.token) return false;
        try {
            const res = await fetch(`${API}/api/auth/me`, {
                headers: { 'x-auth-token': Auth.token }
            });
            if (res.ok) {
                const data = await res.json();
                Auth.user = data;
                localStorage.setItem('cyberdeck_user', JSON.stringify(data));
                return true;
            }
        } catch { /* ignore */ }

        // Session invalid
        Auth.clearSession();
        return false;
    },

    async logout() {
        try {
            await fetch(`${API}/api/auth/logout`, {
                method: 'POST',
                headers: { 'x-auth-token': Auth.token }
            });
        } catch { /* ignore */ }
        Auth.stopBackgroundTasks();
        Auth.clearSession();
        Auth.showLogin(true); // Force clear on deliberate logout
    },

    clearSession() {
        Auth.token = null;
        Auth.user = null;
        MediaAuth.clear();
        localStorage.removeItem('cyberdeck_token');
        localStorage.removeItem('cyberdeck_user');
        Auth.stopBackgroundTasks();
    },

    stopBackgroundTasks() {
        // Every module is now assigned to window at the bottom of its file.
        // Previously these were top-level `const` declarations, which do not
        // land on window, so all of these guards were silently false and
        // nothing was ever stopped on logout.
        if (Auth.connInterval) { clearInterval(Auth.connInterval); Auth.connInterval = null; }

        const clearField = (moduleName, field, kind = 'interval') => {
            const mod = window[moduleName];
            if (mod && mod[field]) {
                (kind === 'timeout' ? clearTimeout : clearInterval)(mod[field]);
                mod[field] = null;
            }
        };

        clearField('PowerModule', '_interval');
        clearField('NearbyModule', 'pollTimer');
        clearField('ChatModule', 'dtnSyncInterval');
        clearField('DtnModule', '_interval');
        clearField('DashboardModule', '_meshPoll');
        clearField('MapsModule', '_pollTimer', 'timeout');

        // Self-rescheduling poll chains own their own cleanup.
        if (window.NearbyModule?.stopPolling) window.NearbyModule.stopPolling();
        if (window.StoreModule?.stopPolling) window.StoreModule.stopPolling();

        // The chat socket reconnects on close, so it has to be told not to.
        if (window.ChatModule?.disconnect) window.ChatModule.disconnect();

        // The mesh visualiser holds a requestAnimationFrame loop, a poll
        // interval and a window resize listener, none of which were released.
        if (window.MeshModule?.visualizer?.stop) window.MeshModule.visualizer.stop();

        // Reset module load states so they re-init on next login
        document.querySelectorAll('.module').forEach(m => {
            delete m.dataset.loaded;
            m.innerHTML = '';
            delete m.dataset.delegated;
            delete m.dataset.eventsBound;
        });
    },

    showLogin(forceClear = false) {
        const overlay = document.getElementById('loginOverlay');
        const isAlreadyVisible = !overlay.classList.contains('hidden');

        overlay.classList.remove('hidden');
        document.getElementById('loginError').style.display = 'none';

        // Clear if forced OR if we are switching from app view to login view
        if (forceClear || !isAlreadyVisible) {
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginUsername').focus();
        }
    },

    showApp() {
        document.getElementById('loginOverlay').classList.add('hidden');
        // Show user info in sidebar
        const userInfo = document.getElementById('userInfo');
        userInfo.style.display = 'flex';
        document.getElementById('userName').textContent = Auth.user?.username || '';

        // Initialize first module
        switchModule('dashboard');
        
        // Start background tasks
        checkConnection();
        if (Auth.connInterval) clearInterval(Auth.connInterval);
        Auth.connInterval = setInterval(checkConnection, 30000);
    }
};

// ═══════════════════════════════════════════
// Authenticated Fetch Helper
// ═══════════════════════════════════════════

/**
 * Wrapper around fetch() that auto-injects auth token.
 * If the response is 401, redirects to login.
 */
async function authFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (Auth.token) {
        options.headers['x-auth-token'] = Auth.token;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
        Auth.clearSession();
        Auth.showLogin();
        throw new Error('Session expired — please log in again');
    }
    return res;
}

// ═══════════════════════════════════════════
// Module Switch
// ═══════════════════════════════════════════

function switchModule(name) {
    // An unknown name used to throw on the first null dereference, leaving the
    // UI with every module deactivated and no way back.
    const modEl = document.getElementById(`mod-${name}`);
    if (!modEl) {
        console.warn(`[App] Unknown module: ${name}`);
        return;
    }

    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    modEl.classList.add('active');
    const navItem = document.querySelector(`.nav-item[data-module="${name}"]`);
    if (navItem) navItem.classList.add('active');

    currentModule = name;

    // Initialize module on first visit
    if (!modEl.dataset.loaded) {
        modEl.dataset.loaded = '1';
        switch (name) {
            case 'dashboard': DashboardModule.init(); break;
            case 'music': MusicModule.init(); break;
            case 'photos': PhotosModule.init(); break;
            case 'videos': VideosModule.init(); break;
            case 'llm': LLMModule.init(); break;
            case 'wiki': WikiModule.init(); break;
            case 'maps': MapsModule.init(); break;
            case 'ebooks': EbooksModule.init(); break;
            // 'files' was routed to a FilesModule that does not exist, and there
            // is no #mod-files container or nav entry. Removed rather than stubbed.
            case 'survival': SurvivalModule.init(); break;
            case 'utils': UtilsModule.init(); break;
            case 'vault': VaultModule.init(); break;
            case 'chat': ChatModule.init(); break;
            case 'power': PowerModule.init(); break;
            case 'store': StoreModule.init(); break;
            case 'nearby': NearbyModule.init(); break;
            case 'dtn': DtnModule.init(); break;
            case 'mesh': MeshModule.init(); break;
        }
    }

    // Show player bar only on music tab
    const playerBar = document.getElementById('playerBar');
    if (name === 'music' && MusicPlayer.currentTrack) {
        playerBar.style.display = 'flex';
        modEl.classList.add('has-player');
    } else {
        playerBar.style.display = 'none';
        modEl.classList.remove('has-player');
    }

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        closeSidebar();
    }
}

// Sidebar toggle
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (window.innerWidth <= 768) {
        const isOpen = sidebar.classList.toggle('open');
        if (isOpen) {
            backdrop.classList.add('visible');
        } else {
            backdrop.classList.remove('visible');
        }
    } else {
        sidebar.classList.toggle('collapsed');
        sidebarCollapsed = sidebar.classList.contains('collapsed');
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
}

// Connection check
async function checkConnection() {
    const dot = document.querySelector('.conn-dot');
    const text = document.querySelector('.conn-text');
    try {
        const res = await fetch(`${API}/api/auth/me`, {
            headers: { 'x-auth-token': Auth.token },
            signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
            dot.classList.remove('offline');
            text.textContent = 'Connected';
        } else {
            dot.classList.add('offline');
            text.textContent = 'Auth error';
        }
    } catch {
        dot.classList.add('offline');
        text.textContent = 'Offline';
    }
}

// ═══════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFileIcon(ext, isDir) {
    if (isDir) return '📁';
    const icons = {
        flac: '🎵', mp3: '🎵', ogg: '🎵', wav: '🎵', aac: '🎵', m4a: '🎵',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️',
        mp4: '🎬', mkv: '🎬', webm: '🎬', avi: '🎬', mov: '🎬',
        pdf: '📄', epub: '📖', txt: '📝', doc: '📄', docx: '📄',
        zip: '📦', tar: '📦', gz: '📦', rar: '📦',
        apk: '📱', exe: '💻', js: '⚙️', py: '🐍', html: '🌐', css: '🎨',
        json: '📋', xml: '📋', csv: '📊'
    };
    return icons[ext] || '📄';
}

// ═══════════════════════════════════════════
// Init
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    // Check if we have a valid session
    const valid = await Auth.checkSession();
    if (valid) {
        Auth.showApp();
    } else {
        Auth.showLogin();
    }
    // Auth.startBackgroundTasks owns the connection poller; a second untracked
    // interval here kept polling with a null token after logout.
});
