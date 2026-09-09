// ═══════════════════════════════════════════
// CyberDeck - Dashboard Module
// ═══════════════════════════════════════════

const DashboardModule = {
    isPerformanceMode: localStorage.getItem('cd_perf_mode') === 'true',

    async init() {
        // The persisted setting only styled the button before; the body class
        // that actually does anything was applied solely by togglePerformanceMode.
        document.body.classList.toggle('perf-mode', this.isPerformanceMode);

        const el = document.getElementById('mod-dashboard');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Operational Dashboard</div>
                    <div class="module-subtitle">System status & secure mesh activity</div>
                </div>
                <div class="dash-controls">
                    <button id="perf-toggle" class="btn btn-perf ${this.isPerformanceMode ? 'on' : ''}" onclick="DashboardModule.togglePerformanceMode()">
                        ${this.isPerformanceMode ? 'Performance Mode ON' : 'Performance Mode OFF'}
                    </button>
                </div>
            </div>

            <div class="dash-grid">
                <!-- Mesh Activity -->
                <div class="card dash-mesh-card" style="grid-column: span 12;">
                    <h3>Secure Mesh Activity</h3>
                    <div id="dash-mesh-activity" class="activity-feed">
                        <div class="empty-state">Scan initiated...</div>
                    </div>
                </div>
                
                <!-- Quick Access -->
                <div class="card dash-quick-card">
                    <h3>Mission Directives</h3>
                    <div class="quick-links">
                        <button class="nav-item" onclick="switchModule('chat')">Open Mesh Chat</button>
                        <button class="nav-item" onclick="switchModule('store')">Store</button>
                    </div>
                </div>
            </div>`;

        // _interval is never assigned by this module; _meshPoll is the real one.
        this.renderMeshActivity();
        this.startMeshPolling();
    },

    togglePerformanceMode() {
        this.isPerformanceMode = !this.isPerformanceMode;
        localStorage.setItem('cd_perf_mode', this.isPerformanceMode);
        
        const btn = document.getElementById('perf-toggle');
        if (this.isPerformanceMode) {
            btn.classList.add('on');
            btn.textContent = 'Performance Mode ON';
            document.body.classList.add('perf-mode');
        } else {
            btn.classList.remove('on');
            btn.textContent = 'Performance Mode OFF';
            document.body.classList.remove('perf-mode');
        }
    },

    async renderMeshActivity(silent = false) {
        const feed = document.getElementById('dash-mesh-activity');
        if (!feed) return;

        try {
            const res = await authFetch(`${API}/api/system/mesh-activity`);
            const data = await res.json();
            const events = data.events || [];

            if (events.length === 0) {
                if (!silent) feed.innerHTML = '<div class="empty-state">Scan initiated... Listening for network events...</div>';
                return;
            }

            feed.innerHTML = events.map(e => `
                <div class="activity-item" style="animation: fadeIn 0.4s ease forwards">
                    <span class="activity-time">${new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span class="activity-msg">${escapeHtml(e.msg)}</span>
                </div>
            `).join('');
        } catch (e) {
            console.error('Mesh activity fetch failed', e);
        }

    },

    /** Start the mesh-activity poller. Idempotent. */
    startMeshPolling() {
        if (this._meshPoll) clearInterval(this._meshPoll);
        this._meshPoll = setInterval(() => {
            const page = document.getElementById('mod-dashboard');
            if (page && page.classList.contains('active')) {
                this.renderMeshActivity(true);
            }
        }, 5000);
    }
};

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.DashboardModule = DashboardModule;
