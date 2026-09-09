// ═══════════════════════════════════════════
// CyberDeck - Utilities Toolkit
// ═══════════════════════════════════════════

const UtilsModule = {
    init() {
        const el = document.getElementById('mod-utils');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Utilities</div>
                    <div class="module-subtitle">Essential offline tools</div>
                </div>
            </div>
            <div class="utils-grid">
                <div class="util-card card" onclick="UtilsModule.showTool('morse')">
                    <div class="util-icon">📡</div><div class="util-name">Morse Code</div>
                </div>
                <div class="util-card card" onclick="UtilsModule.showTool('converter')">
                    <div class="util-icon">📐</div><div class="util-name">Unit Converter</div>
                </div>
                <div class="util-card card" onclick="UtilsModule.showTool('coords')">
                    <div class="util-icon">🧭</div><div class="util-name">Coordinates</div>
                </div>
                <div class="util-card card" onclick="UtilsModule.showTool('compass')">
                    <div class="util-icon">🧭</div><div class="util-name">Compass</div>
                </div>
                <div class="util-card card" onclick="UtilsModule.showTool('torch')">
                    <div class="util-icon">🔦</div><div class="util-name">Flashlight</div>
                </div>
                <div class="util-card card" onclick="UtilsModule.showTool('calc')">
                    <div class="util-icon">🧮</div><div class="util-name">Calculator</div>
                </div>
            </div>
            <div id="utilToolArea"></div>
        `;
    },

    showTool(name) {
        const area = document.getElementById('utilToolArea');
        switch (name) {
            case 'morse': area.innerHTML = this.morseUI(); break;
            case 'converter': area.innerHTML = this.converterUI(); break;
            case 'coords': area.innerHTML = this.coordsUI(); break;
            case 'compass': area.innerHTML = this.compassUI(); this.startCompass(); break;
            case 'torch': area.innerHTML = this.torchUI(); break;
            case 'calc': area.innerHTML = this.calcUI(); break;
        }
    },

    // ── Morse Code ──
    morseUI() {
        return `
            <div class="tool-panel">
                <h3>📡 Morse Code Encoder/Decoder</h3>
                <div class="tool-row">
                    <textarea id="morseInput" class="tool-input" rows="3" placeholder="Type text to encode or morse to decode (use . and -)"></textarea>
                </div>
                <div style="display:flex;gap:8px;margin:12px 0">
                    <button class="btn btn-primary" onclick="UtilsModule.textToMorse()">Text → Morse</button>
                    <button class="btn btn-primary" onclick="UtilsModule.morseToText()">Morse → Text</button>
                    <button class="btn" onclick="UtilsModule.playMorse()">🔊 Play</button>
                </div>
                <div id="morseOutput" class="tool-output" style="font-family:'JetBrains Mono',monospace;font-size:18px;letter-spacing:4px"></div>
            </div>`;
    },

    MORSE: { 'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.', '0': '-----', ' ': '/', 'SOS': '...---...' },

    textToMorse() {
        const text = document.getElementById('morseInput').value.toUpperCase();
        const morse = text.split('').map(c => this.MORSE[c] || c).join(' ');
        document.getElementById('morseOutput').textContent = morse;
    },

    morseToText() {
        const morse = document.getElementById('morseInput').value.trim();
        const REVERSE = {};
        for (const [k, v] of Object.entries(this.MORSE)) REVERSE[v] = k;
        const text = morse.split(' ').map(m => m === '/' ? ' ' : (REVERSE[m] || '?')).join('');
        document.getElementById('morseOutput').textContent = text;
    },

    async playMorse() {
        const morse = document.getElementById('morseOutput')?.textContent || document.getElementById('morseInput').value;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dotLen = 0.08;

        for (const char of morse) {
            if (char === '.') { await this.beep(ctx, dotLen); await this.pause(dotLen); }
            else if (char === '-') { await this.beep(ctx, dotLen * 3); await this.pause(dotLen); }
            else if (char === ' ') { await this.pause(dotLen * 3); }
            else if (char === '/') { await this.pause(dotLen * 7); }
        }
        ctx.close();
    },

    beep(ctx, duration) {
        return new Promise(resolve => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 700; gain.gain.value = 0.3;
            osc.start(); osc.stop(ctx.currentTime + duration);
            setTimeout(resolve, duration * 1000);
        });
    },

    pause(duration) { return new Promise(r => setTimeout(r, duration * 1000)); },

    // ── Unit Converter ──
    converterUI() {
        return `
            <div class="tool-panel">
                <h3>📐 Unit Converter</h3>
                <div class="tool-row" style="display:flex;gap:12px;flex-wrap:wrap">
                    <select id="convCategory" class="tool-select" onchange="UtilsModule.updateConvUnits()">
                        <option value="distance">Distance</option>
                        <option value="weight">Weight</option>
                        <option value="temp">Temperature</option>
                        <option value="volume">Volume</option>
                        <option value="speed">Speed</option>
                    </select>
                    <input type="number" id="convInput" class="tool-input" style="width:120px" value="1" oninput="UtilsModule.convert()">
                    <select id="convFrom" class="tool-select" onchange="UtilsModule.convert()"></select>
                    <span style="padding:8px;color:var(--cyan)">→</span>
                    <select id="convTo" class="tool-select" onchange="UtilsModule.convert()"></select>
                </div>
                <div id="convResult" class="tool-output" style="font-size:24px;font-weight:bold;color:var(--cyan)"></div>
            </div>`;
    },

    UNITS: {
        distance: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.34, ft: 0.3048, 'in': 0.0254, yd: 0.9144 },
        weight: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 1000 },
        volume: { L: 1, mL: 0.001, gal: 3.78541, qt: 0.946353, cup: 0.236588, floz: 0.0295735 },
        speed: { 'm/s': 1, 'km/h': 0.277778, 'mph': 0.44704, knot: 0.514444 }
    },

    updateConvUnits() {
        const cat = document.getElementById('convCategory').value;
        if (cat === 'temp') {
            const opts = '<option>°C</option><option>°F</option><option>K</option>';
            document.getElementById('convFrom').innerHTML = opts;
            document.getElementById('convTo').innerHTML = opts;
            document.getElementById('convTo').selectedIndex = 1;
        } else {
            const units = Object.keys(this.UNITS[cat]);
            const opts = units.map(u => `<option value="${u}">${u}</option>`).join('');
            document.getElementById('convFrom').innerHTML = opts;
            document.getElementById('convTo').innerHTML = opts;
            if (units.length > 1) document.getElementById('convTo').selectedIndex = 1;
        }
        this.convert();
    },

    convert() {
        const cat = document.getElementById('convCategory').value;
        const val = parseFloat(document.getElementById('convInput').value) || 0;
        const from = document.getElementById('convFrom').value;
        const to = document.getElementById('convTo').value;
        let result;

        if (cat === 'temp') {
            const toC = { '°C': v => v, '°F': v => (v - 32) * 5 / 9, 'K': v => v - 273.15 };
            const fromC = { '°C': v => v, '°F': v => v * 9 / 5 + 32, 'K': v => v + 273.15 };
            result = fromC[to](toC[from](val));
        } else {
            const base = val * this.UNITS[cat][from];
            result = base / this.UNITS[cat][to];
        }

        document.getElementById('convResult').textContent = `${result.toFixed(4)} ${to}`;

        // Auto-init selects on first call
        if (!document.getElementById('convFrom').options.length) this.updateConvUnits();
    },

    // ── Coordinate Converter ──
    coordsUI() {
        return `
            <div class="tool-panel">
                <h3>🧭 Coordinate Converter</h3>
                <div class="tool-row">
                    <label style="color:var(--text-dim);font-size:12px">Decimal (e.g. 28.6139, 77.2090)</label>
                    <input type="text" id="coordDec" class="tool-input" placeholder="lat, lng" oninput="UtilsModule.decToDMS()">
                </div>
                <div class="tool-row" style="margin-top:12px">
                    <label style="color:var(--text-dim);font-size:12px">DMS (e.g. 28°36'50"N, 77°12'32"E)</label>
                    <input type="text" id="coordDMS" class="tool-input" readonly>
                </div>
                <button class="btn" onclick="UtilsModule.getMyCoords()" style="margin-top:12px">📍 Get My Location</button>
            </div>`;
    },

    decToDMS() {
        const input = document.getElementById('coordDec').value;
        const parts = input.split(',').map(s => parseFloat(s.trim()));
        if (parts.length !== 2 || parts.some(isNaN)) return;
        const [lat, lng] = parts;
        const convert = (d) => { const abs = Math.abs(d); const deg = Math.floor(abs); const min = Math.floor((abs - deg) * 60); const sec = ((abs - deg - min / 60) * 3600).toFixed(1); return `${deg}°${min}'${sec}"`; };
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        document.getElementById('coordDMS').value = `${convert(lat)}${latDir}, ${convert(lng)}${lngDir}`;
    },

    getMyCoords() {
        navigator.geolocation?.getCurrentPosition(pos => {
            document.getElementById('coordDec').value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
            this.decToDMS();
        }, () => alert('Location access denied'));
    },

    // ── Compass ──
    compassUI() {
        return `
            <div class="tool-panel" style="text-align:center">
                <h3>🧭 Digital Compass</h3>
                <div id="compassRose" style="width:200px;height:200px;margin:20px auto;position:relative">
                    <div style="width:200px;height:200px;border-radius:50%;border:2px solid var(--cyan);display:flex;align-items:center;justify-content:center;font-size:48px;transition:transform 0.3s" id="compassNeedle">🧭</div>
                    <div id="compassDeg" style="font-family:'JetBrains Mono',monospace;font-size:24px;color:var(--cyan);margin-top:12px">—°</div>
                    <div id="compassDir" style="font-size:16px;color:var(--text-dim);margin-top:4px">Waiting for sensor...</div>
                </div>
            </div>`;
    },

    _compassHandler: null,

    startCompass() {
        if (this._compassHandler) window.removeEventListener('deviceorientationabsolute', this._compassHandler);
        this._compassHandler = (e) => {
            const heading = e.alpha ? (360 - e.alpha) : 0;
            document.getElementById('compassNeedle').style.transform = `rotate(${-heading}deg)`;
            document.getElementById('compassDeg').textContent = `${Math.round(heading)}°`;
            const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
            document.getElementById('compassDir').textContent = dirs[Math.round(heading / 45) % 8];
        };
        window.addEventListener('deviceorientationabsolute', this._compassHandler);
        window.addEventListener('deviceorientation', this._compassHandler);
    },

    // ── Torch ──
    torchUI() {
        return `
            <div class="tool-panel" style="text-align:center">
                <h3>🔦 Flashlight</h3>
                <button class="btn btn-primary" id="torchBtn" onclick="UtilsModule.toggleTorch()" style="font-size:48px;padding:32px;border-radius:50%">🔦</button>
                <p style="margin-top:12px;color:var(--text-dim)">Requires Termux:API</p>
                <button class="btn" onclick="UtilsModule.sosFlash()" style="margin-top:12px">🆘 SOS Flash</button>
            </div>`;
    },

    torchOn: false,

    async toggleTorch() {
        this.torchOn = !this.torchOn;
        try { await authFetch(`${API}/api/power/torch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: this.torchOn }) }); }
        catch { }
        document.getElementById('torchBtn').style.background = this.torchOn ? 'var(--yellow)' : '';
    },

    async sosFlash() {
        const pattern = [1, 1, 1, 0, 3, 3, 3, 0, 1, 1, 1]; // SOS: ...---...
        for (const dur of pattern) {
            if (dur > 0) {
                try { await authFetch(`${API}/api/power/torch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) }); }
                catch { }
                await new Promise(r => setTimeout(r, dur * 200));
                try { await authFetch(`${API}/api/power/torch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }); }
                catch { }
                await new Promise(r => setTimeout(r, 200));
            } else {
                await new Promise(r => setTimeout(r, 400));
            }
        }
    },

    // ── Calculator ──
    calcUI() {
        return `
            <div class="tool-panel">
                <h3>🧮 Calculator</h3>
                <input type="text" id="calcDisplay" class="tool-input" style="font-family:'JetBrains Mono',monospace;font-size:24px;text-align:right" readonly>
                <div class="calc-grid">
                    ${['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '←', '='].map(b =>
            `<button class="calc-btn ${b === '=' ? 'calc-eq' : ''}" onclick="UtilsModule.calcPress('${b}')">${b}</button>`
        ).join('')}
                </div>
            </div>`;
    },

    calcExpr: '',

    calcPress(btn) {
        const display = document.getElementById('calcDisplay');
        if (btn === 'C') { this.calcExpr = ''; display.value = ''; }
        else if (btn === '←') { this.calcExpr = this.calcExpr.slice(0, -1); display.value = this.calcExpr; }
        else if (btn === '=') {
            try { display.value = Function('"use strict";return (' + this.calcExpr + ')')(); }
            catch { display.value = 'Error'; }
        }
        else { this.calcExpr += btn; display.value = this.calcExpr; }
    }
};

// Init converter selects on first open
setTimeout(() => {
    if (document.getElementById('convCategory')) UtilsModule.updateConvUnits();
}, 100);

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.UtilsModule = UtilsModule;
