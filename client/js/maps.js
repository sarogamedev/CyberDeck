// ═══════════════════════════════════════════
// CyberDeck - Maps Module
// ═══════════════════════════════════════════

const MapsModule = {
    map: null,

    async init() {
        const el = document.getElementById('mod-maps');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Maps</div>
                    <div class="module-subtitle" id="mapStatus">Loading...</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn" onclick="MapsModule.locateMe()">📍 My Location</button>
                    <button class="btn" id="btn-toggle-maps" onclick="MapsModule.toggleOnline()">🌍 Enable Online Maps</button>
                    <button class="btn btn-primary" id="btn-dl-map" onclick="MapsModule.downloadRegion()">📥 Download Region</button>
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
            this.baseTileUrl = config.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
            this.onlineTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
            this.forceOnline = false;

            document.getElementById('mapStatus').textContent =
                config.enabled && config.tileUrl ? 'Offline tiles loaded' : 'Using online tiles (OSM)';

            // Initialize Leaflet
            this.map = L.map('mapContainer').setView(config.defaultCenter || [20.5937, 78.9629], config.defaultZoom || 5);

            this.tileLayer = L.tileLayer(this.baseTileUrl, {
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
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(this.map);
            setTimeout(() => this.map.invalidateSize(), 200);
        }
    },

    toggleOnline() {
        if (!this.tileLayer) return;
        this.forceOnline = !this.forceOnline;

        if (this.forceOnline) {
            this.tileLayer.setUrl(this.onlineTileUrl);
            document.getElementById('mapStatus').textContent = 'Using online tiles (Forced)';
            document.getElementById('btn-toggle-maps').textContent = '📵 Use Offline Maps';
        } else {
            this.tileLayer.setUrl(this.baseTileUrl);
            document.getElementById('mapStatus').textContent = (this.currentConfig.enabled && this.currentConfig.tileUrl) ? 'Offline tiles loaded' : 'Using online tiles (OSM)';
            document.getElementById('btn-toggle-maps').textContent = '🌍 Enable Online Maps';
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
            btn.textContent = '⏳ Preparing...';

            const res = await authFetch(`${API}/api/maps/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bounds, minZoom, maxZoom })
            });
            const data = await res.json();

            if (data.error) {
                alert(data.error);
                btn.disabled = false;
                btn.textContent = '📥 Download Region';
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
                document.getElementById('btn-dl-map').textContent = '📥 Download Region';
                setTimeout(() => this.loadMap(), 2000); // Reload map to use new tiles
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
            document.getElementById('btn-dl-map').textContent = '📥 Download Region';
        } catch (e) { }
    }
};
