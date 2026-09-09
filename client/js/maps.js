// ═══════════════════════════════════════════
// CyberDeck - Maps Module
// ═══════════════════════════════════════════

const MapsModule = {
    map: null,

    async init() {
        const isSecureContext = window.isSecureContext ||
            (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

        let secureWarning = '';
        if (!isSecureContext) {
            secureWarning = `
                <div style="background: rgba(255,170,0,0.1); border: 1px solid var(--primary-dim); border-left: 4px solid var(--primary); padding: 15px; margin-bottom: 20px; border-radius: var(--radius); position: relative;">
                    <h3 style="color: var(--primary); margin-top: 0; font-family: 'JetBrains Mono', monospace; font-size: 13px;">⚠️ Geolocation Restriction</h3>
                    <p style="margin: 8px 0; font-size: 12px; color: var(--text);">Browser requires HTTPS for "My Location" to work on mobile/remote devices.</p>
                    <button class="btn btn-sm btn-primary" onclick="window.location.href = 'https://' + window.location.hostname + ':8443'">
                        Switch to HTTPS
                    </button>
                </div>
            `;
        }

        const el = document.getElementById('mod-maps');
        el.innerHTML = `
            ${secureWarning}
            <div class="module-header">
                <div>
                    <div class="module-title">Maps</div>
                    <div class="module-subtitle" id="mapStatus">Loading...</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn" onclick="MapsModule.locateMe()">My Location</button>
                    <button class="btn" id="btn-toggle-maps" onclick="MapsModule.toggleOnline()">Enable Online Maps</button>
                    <button class="btn btn-primary" id="btn-dl-map" onclick="MapsModule.downloadRegion()">Download Region</button>
                </div>
            </div>
            
            <div id="mapDlProgress" style="display:none; padding:12px 16px; background:var(--surface); border-bottom:1px solid var(--border); align-items:center; gap:12px;">
                <div style="flex:1">
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                        <span>Downloading Tiles...</span>
                        <span id="mapDlText">0 / 0</span>
                    </div>
                    <div class="power-bar" style="height:6px"><div class="power-bar-fill" id="mapDlFill" style="width:0%"></div></div>
                </div>
                <button class="btn" style="background:var(--red);color:#fff;padding:4px 8px;font-size:12px" onclick="MapsModule.cancelDownload()">Cancel</button>
            </div>
            
            <div class="map-container" id="mapContainer"></div>
        `;

        // Small delay to let DOM render before initializing Leaflet
        await new Promise(r => setTimeout(r, 100));
        await this.loadMap();
    },

    async loadMap() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }

        try {
            const res = await authFetch(`${API}/api/maps/config`);
            const config = await res.json();

            this.currentConfig = config;
            this.onlineTileUrl = config.onlineTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
            this.offlineTileUrl = config.offlineTileUrl ? `${config.offlineTileUrl}${await MediaAuth.param()}` : '';
            this.isOffline = false; // Always start online

            // Show/hide the toggle button based on whether offline tiles exist
            const toggleBtn = document.getElementById('btn-toggle-maps');
            if (config.hasOfflineTiles) {
                toggleBtn.style.display = '';
                toggleBtn.textContent = 'Use Offline Maps';
            } else {
                toggleBtn.style.display = 'none';
            }

            document.getElementById('mapStatus').textContent = 'Using online tiles (OSM)';

            // Initialize Leaflet — always start with online tiles
            this.map = L.map('mapContainer').setView(config.defaultCenter || [20.5937, 78.9629], config.defaultZoom || 5);

            this.tileLayer = L.tileLayer(this.onlineTileUrl, {
                attribution: config.attribution || '© OpenStreetMap contributors',
                maxZoom: 19,
                errorTileUrl: ''
            }).addTo(this.map);

            // Force Leaflet to recalculate size
            setTimeout(() => this.map.invalidateSize(), 200);
        } catch (err) {
            document.getElementById('mapStatus').textContent = 'Map loading failed';

            // Fallback: use OSM directly
            this.map = L.map('mapContainer').setView([20.5937, 78.9629], 5);
            this.tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(this.map);
            setTimeout(() => this.map.invalidateSize(), 200);
        }
    },

    toggleOnline() {
        if (!this.tileLayer) return;
        this.isOffline = !this.isOffline;

        if (this.isOffline && this.offlineTileUrl) {
            this.tileLayer.setUrl(this.offlineTileUrl);
            document.getElementById('mapStatus').textContent = 'Using offline tiles';
            document.getElementById('btn-toggle-maps').textContent = 'Use Online Maps';
        } else {
            this.isOffline = false;
            this.tileLayer.setUrl(this.onlineTileUrl);
            document.getElementById('mapStatus').textContent = 'Using online tiles (OSM)';
            document.getElementById('btn-toggle-maps').textContent = 'Use Offline Maps';
        }
    },

    locateMe() {
        if (!this.map) return;
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    this.map.setView([latitude, longitude], 15);
                    L.marker([latitude, longitude])
                        .addTo(this.map)
                        .bindPopup('📍 You are here')
                        .openPopup();
                },
                (err) => {
                    document.getElementById('mapStatus').textContent = 'Location access denied';
                }
            );
        }
    },

    async downloadRegion() {
        if (!this.map) return;

        const bounds = this.map.getBounds();
        const minZoom = Math.min(this.map.getZoom() - 2, 5); // From roughly country level
        const maxZoom = Math.min(this.map.getZoom() + 2, 16); // Down to high street detail

        if (!confirm(`Download offline tiles for this visible area?\nZoom levels: ${minZoom} to ${maxZoom}\nThis may take a while depending on the size.`)) return;

        try {
            const btn = document.getElementById('btn-dl-map');
            btn.disabled = true;
            btn.textContent = 'Preparing...';

            const res = await authFetch(`${API}/api/maps/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bounds, minZoom, maxZoom })
            });
            const data = await res.json();

            if (data.error) {
                alert(data.error);
                btn.disabled = false;
                btn.textContent = 'Download Region';
                return;
            }

            this.activeDlId = data.downloadId;
            document.getElementById('mapDlProgress').style.display = 'flex';
            this.pollDownload();
        } catch (err) {
            alert('Failed to start map download: ' + err.message);
            document.getElementById('btn-dl-map').disabled = false;
        }
    },

    async pollDownload() {
        if (!this.activeDlId) return;

        try {
            const res = await authFetch(`${API}/api/maps/progress/${this.activeDlId}`);
            const data = await res.json();

            const fill = document.getElementById('mapDlFill');
            const text = document.getElementById('mapDlText');

            if (data.status === 'downloading') {
                const pct = Math.round((data.downloaded / data.total) * 100) || 0;
                fill.style.width = pct + '%';
                text.textContent = `${data.downloaded} / ${data.total} (${pct}%)`;
                setTimeout(() => this.pollDownload(), 1500);
            } else if (data.status === 'complete') {
                fill.style.width = '100%';
                fill.style.background = 'var(--green)';
                text.textContent = 'Complete! Offline tiles are ready.';
                document.getElementById('btn-dl-map').disabled = false;
                document.getElementById('btn-dl-map').textContent = 'Download Region';

                // Hide progress bar and show toggle button after 2 seconds (stay on online tiles)
                setTimeout(async () => {
                    this.activeDlId = null;
                    document.getElementById('mapDlProgress').style.display = 'none';

                    // Re-fetch config to pick up the new offlineTileUrl
                    try {
                        const cfgRes = await authFetch(`${API}/api/maps/config`);
                        const cfg = await cfgRes.json();
                        this.offlineTileUrl = cfg.offlineTileUrl ? `${cfg.offlineTileUrl}${await MediaAuth.param()}` : '';
                        if (cfg.hasOfflineTiles) {
                            const toggleBtn = document.getElementById('btn-toggle-maps');
                            toggleBtn.style.display = '';
                            toggleBtn.textContent = 'Use Offline Maps';
                        }
                    } catch (e) { }
                }, 2000);
            } else if (data.status === 'error') {
                fill.style.background = 'var(--red)';
                text.textContent = 'Failed';
                document.getElementById('btn-dl-map').disabled = false;
            }
        } catch {
            setTimeout(() => this.pollDownload(), 3000);
        }
    },

    async cancelDownload() {
        if (!this.activeDlId) return;
        try {
            await authFetch(`${API}/api/maps/cancel/${this.activeDlId}`, { method: 'POST' });
            this.activeDlId = null;
            document.getElementById('mapDlProgress').style.display = 'none';
            document.getElementById('btn-dl-map').disabled = false;
            document.getElementById('btn-dl-map').textContent = 'Download Region';
        } catch (e) { }
    }
};

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.MapsModule = MapsModule;
