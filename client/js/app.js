// ═══════════════════════════════════════════
// CyberDeck Client - App Controller + Auth
// ═══════════════════════════════════════════

const API = window.location.origin;
let currentModule = 'music';
let sidebarCollapsed = false;

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
        Auth.clearSession();
        Auth.showLogin();
    },

    clearSession() {
        Auth.token = null;
        Auth.user = null;
        localStorage.removeItem('cyberdeck_token');
        localStorage.removeItem('cyberdeck_user');
    },

    showLogin() {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('loginError').style.display = 'none';
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
        document.getElementById('loginUsername').focus();
    },

    showApp() {
        document.getElementById('loginOverlay').classList.add('hidden');
        // Show user info in sidebar
        const userInfo = document.getElementById('userInfo');
        userInfo.style.display = 'flex';
        document.getElementById('userName').textContent = Auth.user?.username || '';

        // Initialize first module
        switchModule('music');
        checkConnection();
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
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById(`mod-${name}`).classList.add('active');
    document.querySelector(`.nav-item[data-module="${name}"]`).classList.add('active');

    currentModule = name;

    // Initialize module on first visit
    const modEl = document.getElementById(`mod-${name}`);
    if (!modEl.dataset.loaded) {
        modEl.dataset.loaded = '1';
        switch (name) {
            case 'music': MusicModule.init(); break;
            case 'photos': PhotosModule.init(); break;
            case 'videos': VideosModule.init(); break;
            case 'llm': LLMModule.init(); break;
            case 'wiki': WikiModule.init(); break;
            case 'maps': MapsModule.init(); break;
            case 'ebooks': EbooksModule.init(); break;
            case 'files': FilesModule.init(); break;
            case 'survival': SurvivalModule.init(); break;
            case 'utils': UtilsModule.init(); break;
            case 'vault': VaultModule.init(); break;
            case 'chat': ChatModule.init(); break;
            case 'power': PowerModule.init(); break;
            case 'store': StoreModule.init(); break;
        }
    }

    // Handle player bar padding
    const playerBar = document.getElementById('playerBar');
    if (playerBar.style.display !== 'none') {
        modEl.classList.add('has-player');
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
    setInterval(checkConnection, 30000);
});
