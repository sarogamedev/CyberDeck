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
                <div style="background: rgba(255,0,0,0.2); border-left: 4px solid #f00; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                    <h3 style="color: #f55; margin-top: 0;">⚠️ Security Restriction (HTTPS Required)</h3>
                    <p style="margin-bottom: 10px;">Modern browsers block microphone, camera, and Bluetooth access over unsecured connections (HTTP). You are currently accessing CyberDeck over HTTP on a local network IP.</p>
                    <button class="hub-btn danger" onclick="window.location.href = 'https://' + window.location.hostname + ':8443'">
                        Switch to Secure Mode (HTTPS:8443)
                    </button>
                    <p style="color: #aaa; font-size: 0.85em; margin-top: 10px;">Note: Since CyberDeck generates an offline certificate, you will see a "Connection is not private" warning. Click <strong>Advanced -> Proceed</strong>.</p>
                </div>
            `;
        }

        const mod = document.getElementById('mod-mesh');
        mod.innerHTML = `
            <div class="hub-header">
                <h2>📡 Mesh Networking</h2>
                <div class="hub-controls">
                    <button class="hub-btn primary" onclick="MeshModule.toggleReceive()" id="btnMeshRx" ${!isSecureContext ? 'disabled' : ''}>Record (RX)</button>
                </div>
            </div>
            <div class="hub-grid" style="display: block;">
                ${secureWarning}
                <div class="file-panel" style="margin-bottom: 20px; ${!isSecureContext ? 'opacity: 0.5; pointer-events: none;' : ''}">
                    <h3>Acoustic Data Transmission (Ultrasound/Audio)</h3>
                    <p style="color: #888; font-size: 0.9em; margin-bottom: 15px;">
                        Transmit text messages through the air using Frequency Shift Keying (MFSK). Requires no Wi-Fi or Bluetooth.
                    </p>
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <input type="text" id="meshTxInput" placeholder="Enter message to transmit (e.g. SOS, GPS Coords)" 
                            style="flex-grow: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid #333; color: #fff; border-radius: 4px;">
                        <button class="hub-btn" onclick="MeshModule.transmitText()">Transmit (TX)</button>
                    </div>
                </div>
                
                <div class="file-panel">
                    <h3>Received Audio Messages</h3>
                    <div id="meshRxBox" style="min-height: 100px; background: #06060b; border: 1px solid #333; border-radius: 4px; padding: 10px; font-family: monospace; color: #0f0; white-space: pre-wrap; overflow-y: auto;">
                        Select "Record (RX)" to start listening for acoustic data...
                    </div>
                    <div id="meshSpectrum" style="margin-top: 10px; height: 30px; background: #000; position: relative; border-radius: 2px; overflow: hidden; display: none;"></div>
                </div>

                <div class="file-panel" style="margin-top: 20px;">
                    <h3>"Sneakernet" QR Code Sync (Optical)</h3>
                    <p style="color: #888; font-size: 0.9em; margin-bottom: 15px;">
                        Transfer highly resilient offline data using your device's camera. Perfect for noisy environments where acoustic data fails.
                    </p>
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <input type="text" id="qrTxInput" placeholder="Enter message to generate QR" 
                            style="flex-grow: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid #333; color: #fff; border-radius: 4px;">
                        <button class="hub-btn primary" onclick="MeshModule.generateQR()">Generate QR</button>
                        <button class="hub-btn" onclick="MeshModule.startScanQR()" id="btnScanQR">Scan Camera</button>
                    </div>

                    <div style="display: flex; gap: 20px;">
                        <div id="qrCodeContainer" style="background: #fff; padding: 10px; display: inline-block; border-radius: 4px; display: none;"></div>
                        
                        <div id="qrScannerContainer" style="display: none; flex-direction: column; gap: 10px;">
                            <video id="qrVideo" style="width: 100%; max-width: 300px; border: 1px solid #333; border-radius: 4px;"></video>
                            <canvas id="qrCanvas" style="display: none;"></canvas>
                            <div id="qrResult" style="color: #0f0; font-family: monospace; background: #000; padding: 10px; border-radius: 4px; min-height: 50px;">Waiting for QR...</div>
                        </div>
                    </div>
                </div>

                <div class="file-panel" style="margin-top: 20px;">
                    <h3>Web Bluetooth Sensors (BLE)</h3>
                    <p style="color: #888; font-size: 0.9em; margin-bottom: 15px;">
                        Connect to nearby Bluetooth Low Energy (BLE) environmental sensors (like Geiger counters or weather stations) directly from your browser. Root access not required.
                    </p>
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <button class="hub-btn primary" onclick="MeshModule.connectBLE()">Pair Sensor</button>
                        <button class="hub-btn danger" onclick="MeshModule.disconnectBLE()" id="btnDisconnectBLE" style="display:none;">Disconnect</button>
                    </div>
                    <div id="bleDataContainer" style="background: #06060b; border: 1px solid #333; border-radius: 4px; padding: 10px; font-family: monospace; color: #0aa; white-space: pre-wrap; min-height: 100px;">
                        Waiting for sensor connection...
                    </div>
                </div>
            </div>
        `;
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
            spec.style.display = 'none';
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
                spec.style.display = 'block';

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
            spec.style.background = `linear-gradient(90deg, #000 ${(maxFreq / 5000) * 100}%, #0f0 ${(maxFreq / 5000) * 100}%, #000 ${(maxFreq / 5000) * 100 + 2}%)`;

            this.handleTone(tone);
        } else {
            spec.style.background = '#000';
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
            document.getElementById('meshRxBox').textContent = '[Receiving] ';
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
            document.getElementById('qrCodeContainer').style.display = 'none';

            this.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            const video = document.getElementById('qrVideo');
            video.srcObject = this.qrStream;
            video.setAttribute("playsinline", true); // required for iOS Safari
            video.play();

            scannerContainer.style.display = 'flex';
            btn.textContent = 'Stop Camera';
            btn.classList.add('danger');

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

        scannerContainer.style.display = 'none';
        btn.textContent = 'Scan Camera';
        btn.classList.remove('danger');
    },

    tickScanQR() {
        if (!this.qrStream) return;
        const video = document.getElementById('qrVideo');
        const canvas = document.getElementById('qrCanvas');
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

            if (code) {
                resEl.textContent = "Data Received:\n" + code.data;
                // Optional: visual feedback
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
            document.getElementById('bleDataContainer').textContent = "Scanning for devices...";

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
                                    const box = document.getElementById('bleDataContainer');
                                    let text = box.textContent;
                                    if (text.includes('\n---Live Data---\n')) {
                                        text = text.split('\n---Live Data---\n')[0];
                                    }
                                    box.textContent = text + '\n---Live Data---\n' +
                                        `[${char.uuid.substring(4, 8)}]: ${val.join(', ')}`;
                                });
                            } catch (e) { }
                        }
                    }
                } catch (e) { }
            }

            document.getElementById('bleDataContainer').textContent = output;
            document.getElementById('btnDisconnectBLE').style.display = 'inline-block';

        } catch (error) {
            document.getElementById('bleDataContainer').textContent = "Connection failed or cancelled.\n" + error;
        }
    },

    disconnectBLE() {
        if (this.bleDevice && this.bleDevice.gatt.connected) {
            this.bleDevice.gatt.disconnect();
        }
    },

    onBLEDisconnected() {
        document.getElementById('bleDataContainer').textContent = "Sensor disconnected.";
        document.getElementById('btnDisconnectBLE').style.display = 'none';
        this.bleDevice = null;
        this.bleServer = null;
    }
};

window.MeshModule = MeshModule;
