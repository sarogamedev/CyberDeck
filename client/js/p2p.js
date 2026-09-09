// ═══════════════════════════════════════════
// CyberDeck - WebRTC P2P File Sharing
// ═══════════════════════════════════════════

const P2PModule = {
    MAX_TRANSFER_BYTES: 4 * 1024 * 1024 * 1024, // 4 GB ceiling on a declared size
    peerConnection: null,
    dataChannel: null,
    fileReader: null,
    receiveBuffer: [],
    receivedSize: 0,
    expectedSize: 0,
    expectedName: '',
    sender: null,

    // Configuration for WebRTC
    rtcConfig: {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    },

    init() {
        // UI is integrated into the Files module and Chat module (for recipient selection)
    },

    updateUsers(users) {
        // Expose LAN users to the Files module for P2P sharing
        const p2pSelect = document.getElementById('p2pUserSelect');
        if (!p2pSelect) return;

        const me = Auth.user?.username || 'Anonymous';
        p2pSelect.innerHTML = '<option value="">Select recipient...</option>';

        users.forEach(u => {
            if (u !== me) {
                const opt = document.createElement('option');
                opt.value = u;
                opt.textContent = u;
                p2pSelect.appendChild(opt);
            }
        });
    },

    async handleSignal(msg) {
        const me = Auth.user?.username || 'Anonymous';

        // Ignore signals not meant for us (unless it's a broadcast offer we might want to accept)
        if (msg.target && msg.target !== me) return;

        switch (msg.type) {
            case 'webrtc-offer':
                await this.handleOffer(msg);
                break;
            case 'webrtc-answer':
                await this.handleAnswer(msg);
                break;
            case 'webrtc-ice':
                await this.handleIceCandidate(msg);
                break;
            case 'webrtc-decline':
                this.handleDecline(msg);
                break;
        }
    },

    // ---------- Sender Logic ----------

    async startP2PShare(file, targetUser) {
        if (!ChatModule.ws || ChatModule.ws.readyState !== WebSocket.OPEN) {
            alert('LAN Chat must be connected to negotiate P2P sharing.');
            return;
        }

        const me = Auth.user?.username || 'Anonymous';

        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ChatModule.ws.send(JSON.stringify({
                    type: 'webrtc-ice',
                    target: targetUser,
                    candidate: event.candidate
                }));
            }
        };

        // Create data channel for file transfer
        this.dataChannel = this.peerConnection.createDataChannel('fileTransfer');
        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            this.sendFile(file);
        };

        // Create and send offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        ChatModule.ws.send(JSON.stringify({
            type: 'webrtc-offer',
            target: targetUser,
            fileName: file.name,
            fileSize: file.size,
            sdp: offer
        }));

        this.updateP2PProgress(null, 0, 'Waiting for recipient to accept...', file.name);
    },

    sendFile(file) {
        this.updateP2PProgress(null, 0, 'Sending...', file.name);
        let offset = 0;
        const chunkSize = 16384; // 16KB chunks
        this.fileReader = new FileReader();

        this.fileReader.onload = (e) => {
            if (this.dataChannel.readyState !== 'open') return;

            this.dataChannel.send(e.target.result);
            offset += e.target.result.byteLength;

            this.updateP2PProgress(null, Math.round((offset / file.size) * 100), 'Sending...', file.name);

            if (offset < file.size) {
                readSlice(offset);
            } else {
                this.updateP2PProgress(null, 100, 'Sent successfully!', file.name);
                setTimeout(() => this.reset(), 3000);
            }
        };

        const readSlice = (o) => {
            const slice = file.slice(offset, o + chunkSize);
            this.fileReader.readAsArrayBuffer(slice);
        };

        // Handle backpressure
        this.dataChannel.bufferedAmountLowThreshold = chunkSize * 2;
        this.dataChannel.onbufferedamountlow = () => {
            if (offset < file.size) readSlice(offset);
        };

        readSlice(0);
    },

    handleDecline(msg) {
        this.updateP2PProgress(msg.from, 0, 'Recipient declined the transfer.', this.expectedName);
        setTimeout(() => this.reset(), 3000);
    },

    // ---------- Receiver Logic ----------

    async handleOffer(msg) {
        // Ask user to accept
        const kbSize = (msg.fileSize / 1024).toFixed(1);
        const accept = confirm(`P2P Incoming File!\n\nUser: ${msg.from}\nFile: ${msg.fileName}\nSize: ${kbSize} KB\n\nAccept transfer?`);

        if (!accept) {
            ChatModule.ws.send(JSON.stringify({
                type: 'webrtc-decline',
                target: msg.from
            }));
            return;
        }

        const declaredSize = Number(msg.fileSize);
        if (!Number.isInteger(declaredSize) || declaredSize <= 0 || declaredSize > this.MAX_TRANSFER_BYTES) {
            console.warn('[P2P] Rejecting offer with an implausible file size');
            return;
        }
        this.expectedSize = declaredSize;
        // Filename comes from the remote peer and becomes a download name.
        this.expectedName = this.sanitizeFileName(msg.fileName);
        this.sender = msg.from;
        this.receivedSize = 0;
        this.receiveBuffer = [];

        this.updateP2PProgress(msg.from, 0, 'Connecting...', msg.fileName);

        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ChatModule.ws.send(JSON.stringify({
                    type: 'webrtc-ice',
                    target: msg.from,
                    candidate: event.candidate
                }));
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            const receiveChannel = event.channel;
            receiveChannel.binaryType = 'arraybuffer';

            receiveChannel.onmessage = (e) => this.handleReceiveMessage(e);
            receiveChannel.onopen = () => this.updateP2PProgress(msg.from, 0, 'Receiving...', msg.fileName);
        };

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        ChatModule.ws.send(JSON.stringify({
            type: 'webrtc-answer',
            target: msg.from,
            sdp: answer
        }));
    },

    handleReceiveMessage(event) {
        // The completion test was `=== expectedSize`, so a peer sending one
        // extra byte overshot it, the equality never held, and receiveBuffer
        // grew without bound. expectedSize itself is peer-supplied.
        if (this.receivedSize >= this.expectedSize) return;

        this.receiveBuffer.push(event.data);
        this.receivedSize += event.data.byteLength;

        if (this.receivedSize > this.expectedSize) {
            console.warn('[P2P] Peer sent more data than declared; aborting transfer');
            this.updateP2PProgress(this.sender, 0, 'Transfer aborted: size mismatch', this.expectedName);
            this.reset();
            return;
        }

        const pct = Math.round((this.receivedSize / this.expectedSize) * 100);
        this.updateP2PProgress(this.sender, pct, 'Receiving...', this.expectedName);

        if (this.receivedSize === this.expectedSize) {
            this.saveReceivedFile();
        }
    },

    saveReceivedFile() {
        const received = new Blob(this.receiveBuffer);
        this.receiveBuffer = []; // Clear memory

        const url = URL.createObjectURL(received);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.expectedName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        this.updateP2PProgress(this.sender, 100, 'File received and downloaded!', this.expectedName);
        setTimeout(() => this.reset(), 3000);
    },

    // ---------- Shared Connection Logic ----------

    async handleAnswer(msg) {
        if (!this.peerConnection) return;
        const remoteDesc = new RTCSessionDescription(msg.sdp);
        await this.peerConnection.setRemoteDescription(remoteDesc);
    },

    async handleIceCandidate(msg) {
        if (!this.peerConnection) return;
        try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    },

    /** Strip path separators and control characters from a peer filename. */
    sanitizeFileName(name) {
        const base = String(name || 'received-file')
            .replace(/[\\/]/g, '_')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .replace(/^\.+/, '')
            .trim();
        return base.slice(0, 200) || 'received-file';
    },

    reset() {
        this.expectedSize = 0;
        this.expectedName = null;
        this.receivedSize = 0;
        this.receiveBuffer = [];
        this.sender = null;

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.receiveBuffer = [];
        this.hideP2PProgress();
    },

    // ---------- UI Helpers ----------

    updateP2PProgress(user, pct, statusText, fileName) {
        // UI overlay logic
        let overlay = document.getElementById('p2pOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'p2pOverlay';
            overlay.innerHTML = `
                <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                        <span style="font-size:24px">📡</span>
                        <div>
                            <div style="font-weight:bold" id="p2pFileName">File Transfer</div>
                            <div style="font-size:12px;color:var(--text-dim)" id="p2pStatusText">Status...</div>
                        </div>
                    </div>
                    <div class="power-bar" style="height:6px"><div class="power-bar-fill" id="p2pFill" style="width:0%"></div></div>
                </div>
            `;
            // Add a container style to display fixed bottom right
            overlay.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:10000;width:300px;transition:opacity 0.2s';
            document.body.appendChild(overlay);
        }

        overlay.style.display = 'block';
        document.getElementById('p2pFileName').textContent = fileName;
        document.getElementById('p2pStatusText').textContent = user ? `${statusText} (${user})` : statusText;
        document.getElementById('p2pFill').style.width = pct + '%';
        if (pct === 100) document.getElementById('p2pFill').style.background = 'var(--green)';
    },

    hideP2PProgress() {
        const overlay = document.getElementById('p2pOverlay');
        if (overlay) overlay.style.display = 'none';
    }
};

window.P2PModule = P2PModule;
