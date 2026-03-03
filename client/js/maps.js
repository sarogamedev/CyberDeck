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
                <div style="display:flex;gap:8px">
                    <button class="btn" onclick="MapsModule.locateMe()">📍 My Location</button>
                </div>
            </div>
            <div class="map-container" id="mapContainer"></div>
        `;

        // Small delay to let DOM render before initializing Leaflet
        await new Promise(r => setTimeout(r, 100));
        await this.loadMap();
    },

    async loadMap() {
        try {
            const res = await authFetch(`${API}/api/maps/config`);
            const config = await res.json();

            document.getElementById('mapStatus').textContent =
                config.enabled ? 'Offline tiles loaded' : 'Using online tiles (OSM)';

            // Initialize Leaflet
            this.map = L.map('mapContainer').setView(config.defaultCenter, config.defaultZoom);

            L.tileLayer(config.tileUrl, {
                attribution: config.attribution,
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
    }
};
