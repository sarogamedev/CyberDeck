// ═══════════════════════════════════════════
// Mesh Network Module (Acoustic, QR, BLE)
// ═══════════════════════════════════════════

const MeshModule = {
    audioCtx: null,
    analyser: null,
    mediaStreamSource: null,
    isReceiving: false,
    receiveLoop: null,

    // MFSK Modem Parameters
    FREQ_START: 1000,
    FREQ_CLOCK: 1200,
    FREQ_END: 5000,
    FREQ_BASE: 1500,
    FREQ_STEP: 200,
    DUR_TONE: 80,   // ms
    DUR_CLOCK: 40,  // ms
    DUR_START: 400, // ms
    DUR_END: 400,   // ms
    THRESHOLD: -50, // dB

    rxState: 'IDLE', // IDLE, CLOCK, NIBBLE
    rxBuffer: [],
    rxChars: '',
    lastTone: null,

    init() {
        const isSecureContext = window.isSecureContext ||
            (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

        let secureWarning = '';
        if (!isSecureContext) {
            secureWarning = `
                <div style="background: rgba(255,170,0,0.1); border: 1px solid var(--primary-dim); border-left: 4px solid var(--primary); padding: 20px; margin-bottom: 24px; border-radius: var(--radius); position: relative; overflow: hidden;">
                    <div style="position: absolute; top:0; left:0; right:0; height:1px; background: linear-gradient(90deg, transparent, var(--primary), transparent); opacity: 0.5;"></div>
                    <h3 style="color: var(--primary); margin-top: 0; font-family: 'JetBrains Mono', monospace; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
                        ⚠️ Security Restriction (HTTPS Required)
                    </h3>
                    <p style="margin: 12px 0; font-size: 13px; line-height: 1.5; color: var(--text);">
                        Modern browsers block microphone, camera, and Bluetooth access over unsecured connections (HTTP). 
                        To use <strong>Acoustic Comm</strong> or <strong>Acoustic RX</strong>, you must switch to a secure context.
                    </p>
                    <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                        <button class="btn btn-primary" onclick="window.location.href = 'https://' + window.location.hostname + ':8443'">
                            Switch to Secure Mode (HTTPS:8443)
                        </button>
                        <span style="color: var(--text-dim); font-size: 11px; font-family: 'JetBrains Mono', monospace; max-width: 300px;">
                            Note: Click "Advanced" -> "Proceed" when the browser warns about the self-signed certificate.
                        </span>
                    </div>
                </div>
            `;
        }

        const mod = document.getElementById('mod-mesh');
        mod.innerHTML = `
            ${secureWarning}
            <div class="module-header">
                <div>
                    <div class="module-title">Secure Mesh Net</div>
                    <div class="module-subtitle">Interactive node topology & signal visualization</div>
                </div>
                <div class="dash-controls">
                    <button class="btn" onclick="MeshModule.toggleVisualizerMode()" id="btnMeshMode">2D VIEW</button>
                    <button class="btn btn-primary" onclick="MeshModule.toggleReceive()" id="btnMeshRx" ${!isSecureContext ? 'disabled' : ''}>
                        Record (RX)
                    </button>
                </div>
            </div>

            <div class="dash-grid">
                <!-- Visualizer Card -->
                <div class="card" style="grid-column: span 12; padding: 0; min-height: 400px; overflow: hidden; position: relative;">
                    <canvas id="meshVisualizerCanvas" style="width: 100%; height: 400px; display: block;"></canvas>
                    <div id="vis-overlay" style="position: absolute; bottom: 15px; left: 15px; pointer-events: none; text-shadow: 0 0 5px #000;">
                        <div id="vis-node-count" class="tag tag-cyan">Scanning for peers...</div>
                    </div>
                </div>

                <!-- Acoustic Controls -->
                <div class="card" style="grid-column: span 6; ${!isSecureContext ? 'opacity: 0.5; pointer-events: none;' : ''}">
                    <h3 style="color:var(--primary);margin-bottom:12px">Acoustic Comm (MFSK Audio)</h3>
                    <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                        <input type="text" id="meshTxInput" 
                               style="flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 16px; color: var(--text); outline: none; transition: border-color var(--transition); width: 100%;"
                               onfocus="this.style.borderColor='var(--primary)'; this.style.boxShadow='var(--glow-primary)'" 
                               onblur="this.style.borderColor='var(--border)'; this.style.boxShadow='none'"
                               placeholder="Burst transmission mode...">
                        <button class="btn btn-primary" onclick="MeshModule.transmitText()" style="min-width: 80px;">TX</button>
                    </div>
                    <div id="meshRxBox" style="height: 120px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; font-family: 'JetBrains Mono', monospace; color: var(--green); white-space: pre-wrap; overflow-y: auto; font-size: 11px;">Select "Record (RX)" to start listening...</div>
                </div>

                <!-- Optical Controls -->
                <div class="card" style="grid-column: span 6;">
                    <h3 style="color:var(--primary);margin-bottom:12px">Optical Sync (QR Bridge)</h3>
                    <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                        <input type="text" id="qrTxInput" 
                               style="flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 16px; color: var(--text); outline: none; transition: border-color var(--transition); width: 100%;"
                               onfocus="this.style.borderColor='var(--primary)'; this.style.boxShadow='var(--glow-primary)'" 
                               onblur="this.style.borderColor='var(--border)'; this.style.boxShadow='none'"
                               placeholder="Optical payload encoder...">
                        <button class="btn btn-primary" onclick="MeshModule.generateQR()" style="min-width: 100px;">Generate</button>
                    </div>
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <button class="btn" style="flex:1" onclick="MeshModule.startScanQR()" id="btnScanQR">Scan Camera</button>
                        <div id="qrCodeContainer" style="background: #fff; padding: 8px; border-radius: 4px; display: none; width: 80px; height: 80px;"></div>
                    </div>
                </div>

                <!-- BLE Sensor Hub -->
                <div class="card" style="grid-column: span 12;">
                    <h3 style="color:var(--primary);margin-bottom:12px">BLE Environmental Sensors</h3>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn btn-primary" onclick="MeshModule.connectBLE()">Pair Sensor</button>
                        <div id="bleDataContainer" style="flex:1; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; font-family: 'JetBrains Mono', monospace; color: var(--cyan); white-space: pre-wrap; font-size: 11px; min-height: 40px;">Ready for peripheral pairing...</div>
                    </div>
                </div>
            </div>
        `;

        this.initVisualizer();
    },

    visualizer: null,
    is3D: false,

    toggleVisualizerMode() {
        this.is3D = !this.is3D;
        document.getElementById('btnMeshMode').textContent = this.is3D ? '🛰️ 3D VIEW' : '📡 2D VIEW';
        if (this.visualizer) this.visualizer.setMode(this.is3D ? '3d' : '2d');
    },

    initVisualizer() {
        const canvas = document.getElementById('meshVisualizerCanvas');
        if (!canvas) return;

        // Tear down any previous instance first.
        if (this.visualizer) {
            try { this.visualizer.stop(); } catch (e) { }
            this.visualizer = null;
        }

        // Lazy load visualizer logic to keep initial load fast
        this.visualizer = new MeshVisualizer(canvas);
        this.visualizer.start();
    },

    initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    },

    // ═══════════════════════════════════════════
    // TRANSMITTER (TX)
    // ═══════════════════════════════════════════

    async transmitText() {
        const text = document.getElementById('meshTxInput').value.trim();
        if (!text) return;

        this.initAudio();
        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);

        // Disable UI
        document.getElementById('meshTxInput').disabled = true;
        document.getElementById('meshTxInput').value = 'Transmitting...';

        // Calculate sequence
        const sequence = [];

        // Preamble
        sequence.push({ freq: this.FREQ_START, dur: this.DUR_START });

        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            const highNibble = (byte >> 4) & 0x0F;
            const lowNibble = byte & 0x0F;

            sequence.push({ freq: this.FREQ_CLOCK, dur: this.DUR_CLOCK });
            sequence.push({ freq: this.FREQ_BASE + (highNibble * this.FREQ_STEP), dur: this.DUR_TONE });

            sequence.push({ freq: this.FREQ_CLOCK, dur: this.DUR_CLOCK });
            sequence.push({ freq: this.FREQ_BASE + (lowNibble * this.FREQ_STEP), dur: this.DUR_TONE });
        }

        // End of message
        sequence.push({ freq: this.FREQ_CLOCK, dur: this.DUR_CLOCK });
        sequence.push({ freq: this.FREQ_END, dur: this.DUR_END });

        // Play sequence
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.type = 'sine';
        let startTime = this.audioCtx.currentTime + 0.1;

        osc.start(startTime);

        for (let i = 0; i < sequence.length; i++) {
            const t = sequence[i];
            osc.frequency.setValueAtTime(t.freq, startTime);
            // Quick envelope to avoid popping
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(1, startTime + 0.005);
            gain.gain.setValueAtTime(1, startTime + (t.dur / 1000) - 0.005);
            gain.gain.linearRampToValueAtTime(0, startTime + (t.dur / 1000));

            startTime += (t.dur / 1000);
        }

        osc.stop(startTime);

        osc.onended = () => {
            document.getElementById('meshTxInput').disabled = false;
            document.getElementById('meshTxInput').value = '';
        };
    },

    // ═══════════════════════════════════════════
    // RECEIVER (RX)
    // ═══════════════════════════════════════════

    async toggleReceive() {
        const btn = document.getElementById('btnMeshRx');
        const spec = document.getElementById('meshSpectrum');

        if (this.isReceiving) {
            this.isReceiving = false;
            cancelAnimationFrame(this.receiveLoop);
            if (this.mediaStreamSource) {
                this.mediaStreamSource.mediaStream.getTracks().forEach(t => t.stop());
                this.mediaStreamSource.disconnect();
            }
            btn.textContent = 'Record (RX)';
            btn.classList.remove('danger');
            btn.classList.add('primary');
            if (spec) spec.style.display = 'none';
        } else {
            try {
                this.initAudio();
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                });

                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 2048; // Bin size = ~21.5 Hz
                this.analyser.smoothingTimeConstant = 0.2;

                this.mediaStreamSource = this.audioCtx.createMediaStreamSource(stream);
                this.mediaStreamSource.connect(this.analyser);

                this.isReceiving = true;
                btn.textContent = 'Stop RX';
                btn.classList.remove('primary');
                btn.classList.add('danger');
                if (spec) spec.style.display = 'block';

                this.rxState = 'IDLE';
                this.rxBuffer = [];
                this.rxChars = '';

                this.pollAudio();
            } catch (err) {
                alert('Microphone error: ' + err.message);
            }
        }
    },

    logRx(msg, append = false) {
        const box = document.getElementById('meshRxBox');
        if (!box) return;
        if (append) {
            box.textContent += msg;
        } else {
            box.textContent = msg + '\n' + box.textContent;
        }
    },

    pollAudio() {
        if (!this.isReceiving) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        this.analyser.getFloatFrequencyData(dataArray);

        let maxVal = -Infinity;
        let maxFreq = 0;

        // Scan our frequency range of interest
        for (let i = 0; i < bufferLength; i++) {
            const freq = i * this.audioCtx.sampleRate / this.analyser.fftSize;
            if (freq >= 800 && freq <= 5200) {
                if (dataArray[i] > maxVal) {
                    maxVal = dataArray[i];
                    maxFreq = freq;
                }
            }
        }

        const spec = document.getElementById('meshSpectrum');
        if (maxVal > this.THRESHOLD) {
            const tone = this.closestTone(maxFreq);
            // UI visualizer
            if (spec) spec.style.background = `linear-gradient(90deg, #000 ${(maxFreq / 5000) * 100}%, #0f0 ${(maxFreq / 5000) * 100}%, #000 ${(maxFreq / 5000) * 100 + 2}%)`;

            this.handleTone(tone);
        } else {
            if (spec) spec.style.background = '#000';
            this.handleTone(null);
        }

        this.receiveLoop = requestAnimationFrame(() => this.pollAudio());
    },

    closestTone(freq) {
        const margin = 60; // hz tolerance
        if (Math.abs(freq - this.FREQ_START) < margin) return 'START';
        if (Math.abs(freq - this.FREQ_CLOCK) < margin) return 'CLOCK';
        if (Math.abs(freq - this.FREQ_END) < margin) return 'END';

        for (let i = 0; i < 16; i++) {
            if (Math.abs(freq - (this.FREQ_BASE + i * this.FREQ_STEP)) < margin) return i;
        }
        return null;
    },

    handleTone(tone) {
        // debounce stability
        if (this.lastTone === tone) return;
        this.lastTone = tone;

        if (tone === 'START') {
            this.rxState = 'CLOCK';
            this.rxBuffer = [];
            const box = document.getElementById('meshRxBox');
            if (box) box.textContent = '[Receiving] ';
            return;
        }

        if (this.rxState === 'IDLE') return;

        if (tone === 'END') {
            this.rxState = 'IDLE';
            try {
                // Decode buffer (pairs of nibbles into bytes)
                const bytes = new Uint8Array(Math.floor(this.rxBuffer.length / 2));
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = (this.rxBuffer[i * 2] << 4) | this.rxBuffer[i * 2 + 1];
                }
                const decoded = new TextDecoder().decode(bytes);
                this.logRx(' -> ' + decoded, true);
                this.logRx('\n-----', true);
            } catch (e) {
                this.logRx(' [Decode Error]', true);
            }
            return;
        }

        if (tone === 'CLOCK') {
            this.rxState = 'NIBBLE';
            return;
        }

        if (this.rxState === 'NIBBLE' && typeof tone === 'number') {
            this.rxBuffer.push(tone);
            this.logRx(tone.toString(16), true); // Show hex as it arrives
            this.rxState = 'CLOCK'; // wait for clock again
        }
    },

    // ═══════════════════════════════════════════
    // SNEAKERNET QR SYNC (OPTICAL)
    // ═══════════════════════════════════════════

    qrCodeObj: null,
    qrScanLoop: null,
    qrStream: null,

    generateQR() {
        const text = document.getElementById('qrTxInput').value.trim();
        if (!text) return;

        const container = document.getElementById('qrCodeContainer');
        container.style.display = 'inline-block';
        container.innerHTML = ''; // clear previous

        // Use the globally loaded QRCode library
        this.qrCodeObj = new QRCode(container, {
            text: text,
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });

        // Hide scanner if open
        this.stopScanQR();
    },

    async startScanQR() {
        const scannerContainer = document.getElementById('qrScannerContainer');
        const btn = document.getElementById('btnScanQR');

        if (this.qrStream) {
            this.stopScanQR();
            return;
        }

        try {
            // Hide Generator
            const cont = document.getElementById('qrCodeContainer');
            if (cont) cont.style.display = 'none';

            this.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            const video = document.getElementById('qrVideo');
            if (video) {
                video.srcObject = this.qrStream;
                video.setAttribute("playsinline", true); // required for iOS Safari
                video.play();
            }

            if (scannerContainer) scannerContainer.style.display = 'flex';
            if (btn) {
                btn.textContent = 'Stop Camera';
                btn.classList.add('danger');
            }

            this.qrScanLoop = requestAnimationFrame(() => this.tickScanQR());
        } catch (err) {
            alert('Camera error: ' + err.message);
        }
    },

    stopScanQR() {
        const scannerContainer = document.getElementById('qrScannerContainer');
        const btn = document.getElementById('btnScanQR');

        if (this.qrStream) {
            this.qrStream.getTracks().forEach(t => t.stop());
            this.qrStream = null;
        }
        cancelAnimationFrame(this.qrScanLoop);

        if (scannerContainer) scannerContainer.style.display = 'none';
        if (btn) {
            btn.textContent = 'Scan Camera';
            btn.classList.remove('danger');
        }
    },

    tickScanQR() {
        if (!this.qrStream) return;
        const video = document.getElementById('qrVideo');
        const canvas = document.getElementById('qrCanvas');
        if (!video || !canvas) return;
        const context = canvas.getContext("2d");
        const resEl = document.getElementById('qrResult');

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            // Uses globally loaded jsQR
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code && resEl) {
                resEl.textContent = "Data Received:\n" + code.data;
                resEl.style.color = "#0f0";
            }
        }

        // Keep looping
        this.qrScanLoop = requestAnimationFrame(() => this.tickScanQR());
    },

    // ═══════════════════════════════════════════
    // WEB BLUETOOTH SENSORS (BLE)
    // ═══════════════════════════════════════════

    bleDevice: null,
    bleServer: null,

    async connectBLE() {
        if (!navigator.bluetooth) {
            alert("Web Bluetooth API is not supported in this browser. Please use Chrome on Android or PC.");
            return;
        }

        try {
            const box = document.getElementById('bleDataContainer');
            if (box) box.textContent = "Scanning for devices...";

            // Allow any device to pair so we can inspect its generic services.
            this.bleDevice = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: ['battery_service', 'environmental_sensing', 'heart_rate', 'device_information']
            });

            this.bleDevice.addEventListener('gattserverdisconnected', this.onBLEDisconnected.bind(this));

            this.bleServer = await this.bleDevice.gatt.connect();

            let services = await this.bleServer.getPrimaryServices();
            let output = `Connected to: ${this.bleDevice.name || 'Unknown Device'}\n`;
            output += `Services found: ${services.length}\n\n`;

            for (const service of services) {
                output += `Service: ${service.uuid}\n`;
                try {
                    const characteristics = await service.getCharacteristics();
                    for (const char of characteristics) {
                        output += `  ➔ Char: ${char.uuid}\n`;

                        // Try to read generic values
                        if (char.properties.read) {
                            try {
                                const value = await char.readValue();
                                output += `    Value: [${new Uint8Array(value.buffer).join(', ')}]\n`;
                            } catch (e) { }
                        }

                        // Set up notifications if supported
                        if (char.properties.notify) {
                            try {
                                await char.startNotifications();
                                char.addEventListener('characteristicvaluechanged', (e) => {
                                    const val = new Uint8Array(e.target.value.buffer);
                                    const logBox = document.getElementById('bleDataContainer');
                                    if (!logBox) return;
                                    let text = logBox.textContent;
                                    if (text.includes('\n---Live Data---\n')) {
                                        text = text.split('\n---Live Data---\n')[0];
                                    }
                                    logBox.textContent = text + '\n---Live Data---\n' +
                                        `[${char.uuid.substring(4, 8)}]: ${val.join(', ')}`;
                                });
                            } catch (e) { }
                        }
                    }
                } catch (e) { }
            }

            if (box) box.textContent = output;
            const discBtn = document.getElementById('btnDisconnectBLE');
            if (discBtn) discBtn.style.display = 'inline-block';

        } catch (error) {
            const box = document.getElementById('bleDataContainer');
            if (box) box.textContent = "Connection failed or cancelled.\n" + error;
        }
    },

    disconnectBLE() {
        if (this.bleDevice && this.bleDevice.gatt.connected) {
            this.bleDevice.gatt.disconnect();
        }
    },

    onBLEDisconnected() {
        const box = document.getElementById('bleDataContainer');
        if (box) box.textContent = "Sensor disconnected.";
        const discBtn = document.getElementById('btnDisconnectBLE');
        if (discBtn) discBtn.style.display = 'none';
        this.bleDevice = null;
        this.bleServer = null;
    }
};

window.MeshModule = MeshModule;

// Canvas 2D cannot resolve CSS custom properties; assigning 'var(--primary)'
// to fillStyle is silently ignored and the previous fill is reused. Read the
// computed value once instead.
const MESH_PRIMARY = (() => {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        return v || '#00d4ff';
    } catch (e) {
        return '#00d4ff';
    }
})();

class MeshVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.links = [];
        this.mode = '2d'; // '2d' or '3d'
        this.isRunning = false;
        
        this._onResize = () => this.resize();
        this._raf = null;

        this.resize();
        window.addEventListener('resize', this._onResize);
    }

    resize() {
        if (!this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height || 400;
    }

    setMode(mode) {
        this.mode = mode;
        // Reset node positions for fresh 3d perspective simulation
        this.nodes.forEach(n => {
            n.x = Math.random() * this.canvas.width;
            n.y = Math.random() * this.canvas.height;
        });
    }

    addNode(id, label, isMaster = false) {
        if (this.nodes.find(n => n.id === id)) return;
        this.nodes.push({
            id,
            label,
            isMaster,
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            radius: isMaster ? 10 : 6,
            traffic: []
        });
        
        // Auto-link to master if it exists
        if (!isMaster) {
            const master = this.nodes.find(n => n.isMaster);
            if (master) this.links.push({ source: id, target: master.id, strength: Math.random() * 0.8 + 0.2 });
        }
    }

    async pollPeers() {
        try {
            const res = await authFetch(`${API}/api/peers`);
            const data = await res.json();
            
            // 1. Identify "Self" (Master Hub)
            const selfIp = data.self || '127.0.0.1';
            const masterLabel = `MASTER HUB (${selfIp})`;
            
            if (!this.nodes.find(n => n.isMaster)) {
                this.addNode('master', masterLabel, true);
            } else {
                this.nodes.find(n => n.isMaster).label = masterLabel;
            }

            // 2. Sync Peers
            const currentPeerIps = data.peers.map(p => p.ip);
            
            // Add new peers
            currentPeerIps.forEach(ip => {
                if (!this.nodes.find(n => n.id === ip)) {
                    this.addNode(ip, ip);
                }
            });

            // Remove gone peers
            this.nodes = this.nodes.filter(n => n.isMaster || currentPeerIps.includes(n.id));
            this.links = this.links.filter(l => this.nodes.find(n => n.id === l.source) && this.nodes.find(n => n.id === l.target));

        } catch (e) {
            console.error('Peer poll failed:', e);
        }
    }

    start() {
        this.isRunning = true;
        this.animate();
        
        // Start polling real data
        this.pollPeers();
        this._pollInterval = setInterval(() => this.pollPeers(), 5000);
    }

    /**
     * Release everything this instance holds. Previously stop() was never
     * called from anywhere, and initVisualizer built a new instance on each
     * module init, so animation loops, poll intervals and resize listeners
     * accumulated for the life of the page.
     */
    stop() {
        this.isRunning = false;
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        }
    }

    animate() {
        if (!this.isRunning) return;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Physics (Simplified Force-Directed)
        this.nodes.forEach(n => {
            n.x += n.vx;
            n.y += n.vy;
            
            // Keep in bounds
            const pad = 50;
            if (n.x < pad || n.x > this.canvas.width - pad) n.vx *= -1;
            if (n.y < pad || n.y > this.canvas.height - pad) n.vy *= -1;
            
            n.vx *= 0.98;
            n.vy *= 0.98;
            
            n.vx += (Math.random() - 0.5) * 0.1;
            n.vy += (Math.random() - 0.5) * 0.1;

            // Attraction to center (master)
            if (!n.isMaster) {
                const master = this.nodes.find(node => node.isMaster);
                if (master) {
                    const dx = master.x - n.x;
                    const dy = master.y - n.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 150) {
                        n.vx += dx * 0.0001;
                        n.vy += dy * 0.0001;
                    }
                }
            }
        });

        // Draw Links
        this.links.forEach(l => {
            const s = this.nodes.find(n => n.id === l.source);
            const t = this.nodes.find(n => n.id === l.target);
            if (!s || !t) return;

            this.ctx.beginPath();
            this.ctx.moveTo(s.x, s.y);
            this.ctx.lineTo(t.x, t.y);
            this.ctx.strokeStyle = `rgba(255, 170, 0, ${l.strength * 0.3})`;
            this.ctx.lineWidth = 1 + l.strength * 2;
            this.ctx.setLineDash([5, 5]); // Tactical dashed lines
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            
            // Data flow visual
            if (Math.random() < 0.03) s.traffic.push({ progress: 0, target: t });
        });

        // Draw Nodes
        this.nodes.forEach(n => {
            // Glow
            this.ctx.beginPath();
            const grad = this.ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.radius * 3);
            grad.addColorStop(0, n.isMaster ? 'rgba(255, 170, 0, 0.4)' : 'rgba(255, 170, 0, 0.1)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = grad;
            this.ctx.arc(n.x, n.y, n.radius * 3, 0, Math.PI * 2);
            this.ctx.fill();

            // Node Core
            this.ctx.beginPath();
            this.ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = n.isMaster ? 'var(--primary)' : 'rgba(255, 170, 0, 0.6)';
            this.ctx.fill();
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Label
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 11px "JetBrains Mono"';
            this.ctx.shadowColor = '#000';
            this.ctx.shadowBlur = 4;
            this.ctx.fillText(n.label, n.x + 15, n.y + 5);
            this.ctx.shadowBlur = 0;
            
            // Animate traffic particles
            n.traffic = n.traffic.filter(p => {
                p.progress += 0.015;
                const px = n.x + (p.target.x - n.x) * p.progress;
                const py = n.y + (p.target.y - n.y) * p.progress;
                
                this.ctx.beginPath();
                this.ctx.arc(px, py, 2.5, 0, Math.PI * 2);
                this.ctx.fillStyle = MESH_PRIMARY;
                this.ctx.fill();
                
                return p.progress < 1;
            });
        });

        // Update UI status overlay
        const info = document.getElementById('vis-node-count');
        if (info) {
            const peerCount = this.nodes.filter(n => !n.isMaster).length;
            info.textContent = `${peerCount} PEERS DISCOVERED | VIEW: ${this.mode.toUpperCase()}`;
        }

        this._raf = requestAnimationFrame(() => this.animate());
    }
}
