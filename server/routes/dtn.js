const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const meshLogger = require('../utils/meshLogger');
const { resolveWithin, isSafeComponent } = require('../utils/safePath');
const { isPrivateIp, safePort } = require('../utils/netGuard');
const { signedHeaders } = require('../utils/meshAuth');

// Packet IDs are content hashes (SHA-256 hex). Anything else is rejected before
// it can reach the filesystem: an id of "../users" previously wrote outside the
// spool and could overwrite the user database.
const PACKET_ID_RE = /^[0-9a-f]{64}$/;

module.exports = function (config) {
    const router = express.Router();
    const SPOOL_DIR = path.join(__dirname, '..', 'dtn_spool');

    // Ensure spool directory exists
    if (!fs.existsSync(SPOOL_DIR)) {
        fs.mkdirSync(SPOOL_DIR, { recursive: true });
    }

    // Helper: Read all packets from spool
    function getSpoolPackets() {
        const packets = [];
        try {
            const files = fs.readdirSync(SPOOL_DIR);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const data = fs.readFileSync(path.join(SPOOL_DIR, file), 'utf-8');
                    packets.push(JSON.parse(data));
                } catch (e) {
                    // Ignore corrupted files
                }
            }
        } catch (e) {
            console.error('[DTN] Error reading spool:', e);
        }
        return packets;
    }

    // Helper: Write packet to spool (with limits)
    function savePacket(packet) {
        try {
            // The id becomes a filename, so it must be a bare content hash.
            if (!packet || typeof packet.id !== 'string' ||
                !PACKET_ID_RE.test(packet.id) || !isSafeComponent(packet.id)) {
                console.warn('[DTN] Rejecting packet with invalid id');
                return false;
            }

            // Check packet size
            const packetSize = Buffer.byteLength(JSON.stringify(packet), 'utf8');
            if (packetSize > 2 * 1024 * 1024) { // 2MB limit
                console.warn(`[DTN] Rejecting oversized packet: ${packetSize} bytes`);
                return false;
            }

            // Enforce max spool size (e.g., 500 packets)
            const currentPackets = getSpoolPackets();
            if (currentPackets.length >= 500) {
                console.warn('[DTN] Spool threshold reached. Rejecting incoming packet.');
                return false;
            }

            const filePath = resolveWithin(SPOOL_DIR, `${packet.id}.json`);
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, JSON.stringify(packet, null, 2));
                return true;
            }
            return false; // Already exists
        } catch (e) {
            console.error('[DTN] Error saving packet:', e);
            return false;
        }
    }

    // Garbage Collector: Remove expired TTL packets
    function cleanSpool() {
        try {
            const now = Date.now();
            const files = fs.readdirSync(SPOOL_DIR);
            let deletedCount = 0;

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const filePath = path.join(SPOOL_DIR, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    if (data.ttl_expiry && now > data.ttl_expiry) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    }
                } catch (e) {
                    // If JSON is totally corrupt, nuke it
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
            if (deletedCount > 0) console.log(`[DTN] Garbage collected ${deletedCount} expired packets.`);
        } catch (e) {
            // Ignore
        }
    }

    // Run GC every 60 seconds
    setInterval(cleanSpool, 60000);

    // ----------------------------------------------------
    // API ENDPOINTS
    // ----------------------------------------------------

    // 1. Local UI: Get all current packets in the spool
    router.get('/packets', (req, res) => {
        const packets = getSpoolPackets();
        res.json({ packets });
    });

    // 2. Local UI: Inject a new packet into the network
    router.post('/send', (req, res) => {
        const { sender, dest, type, payload, ttl_hours = 48 } = req.body;

        if (typeof payload !== 'string' || payload.length === 0) {
            return res.status(400).json({ error: 'Payload must be a non-empty string' });
        }

        if (Buffer.byteLength(payload, 'utf8') > 2 * 1024 * 1024) {
            return res.status(400).json({ error: 'Payload exceeds 2MB limit' });
        }

        // An unvalidated ttl_hours produced ttl_expiry: NaN, and `now > NaN` is
        // always false, so the packet would never be garbage collected.
        const ttlHours = Number(ttl_hours);
        if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24 * 30) {
            return res.status(400).json({ error: 'ttl_hours must be between 0 and 720' });
        }

        const now = Date.now();
        const packet = {
            id: '',
            timestamp: now,
            ttl_expiry: now + (ttlHours * 60 * 60 * 1000),
            sender: sender || 'anonymous',
            dest: dest || 'ALL',
            type: type || 'text_msg',
            payload: payload
        };

        // Generate ID based on SHA256 of the content
        const hash = crypto.createHash('sha256');
        hash.update(JSON.stringify({ ...packet, id: null }));
        packet.id = hash.digest('hex');

        if (savePacket(packet)) {
            res.json({ success: true, packet });
        } else {
            res.status(500).json({ error: 'Failed to save or packet already exists' });
        }
    });

    // 3. Epidemic Sync: Peer-to-Peer Data Exchange
    // A remote node POSTs an array of packet IDs it already HAS.
    // We return full JSON payloads for anything they are MISSING,
    // and we return an array of IDs that WE want them to send us via their /api/dtn/give
    router.post('/sync/check', (req, res) => {
        const peerKnownIds = req.body.known_ids || [];
        const myPackets = getSpoolPackets();
        const myKnownIds = myPackets.map(p => p.id);

        // What do I have that they don't?
        const packetsForPeer = myPackets.filter(p => !peerKnownIds.includes(p.id));

        // What do they have that I want? (I don't actually know what they have, 
        // they just told me what they *know*, so we just tell them what *we* know, 
        // and they can figure out what to send us).
        // Wait, better algorithm for P2P sync (two-way):

        res.json({
            my_known_ids: myKnownIds,
            payloads_for_you: packetsForPeer
        });
    });

    // 4. Epidemic Sync: Receive missing payloads from a peer
    router.post('/sync/receive', (req, res) => {
        const incomingPackets = req.body.packets || [];
        let accepted = 0;

        if (!Array.isArray(incomingPackets)) {
            return res.status(400).json({ error: 'packets must be an array' });
        }
        if (incomingPackets.length > 500) {
            return res.status(400).json({ error: 'Too many packets in one batch' });
        }

        for (const p of incomingPackets) {
            if (!p || typeof p !== 'object') continue;
            // savePacket re-checks the id, but reject obvious junk up front.
            if (!PACKET_ID_RE.test(String(p.id || ''))) continue;
            if (typeof p.payload !== 'string' || !p.payload) continue;
            if (!Number.isFinite(p.timestamp) || !Number.isFinite(p.ttl_expiry)) continue;

            // Refuse dead packets immediately
            if (Date.now() > p.ttl_expiry) continue;

            if (savePacket(p)) {
                accepted++;
            }
        }

        if (accepted > 0) {
            meshLogger.log(`P2P Sync: Received ${accepted} packets from peer`);
        }

        res.json({ accepted });
    });

    // 4b. Authenticated ingest for the WebSocket DTN bridge.
    //
    // The client relays packets it receives over the LAN chat socket into its
    // own spool. That used to POST to /sync/receive, which now requires the
    // mesh key that a browser does not hold. This is the same logic behind the
    // normal user session guard instead.
    router.post('/ingest', (req, res) => {
        const incomingPackets = req.body.packets || [];
        if (!Array.isArray(incomingPackets)) {
            return res.status(400).json({ error: 'packets must be an array' });
        }
        if (incomingPackets.length > 500) {
            return res.status(400).json({ error: 'Too many packets in one batch' });
        }

        let accepted = 0;
        for (const p of incomingPackets) {
            if (!p || typeof p !== 'object') continue;
            if (!PACKET_ID_RE.test(String(p.id || ''))) continue;
            if (typeof p.payload !== 'string' || !p.payload) continue;
            if (!Number.isFinite(p.timestamp) || !Number.isFinite(p.ttl_expiry)) continue;
            if (Date.now() > p.ttl_expiry) continue;
            if (savePacket(p)) accepted++;
        }

        if (accepted > 0) {
            meshLogger.log(`WS Bridge: Ingested ${accepted} packets`);
        }
        res.json({ accepted });
    });

    // 5. Manual Sync Proxy: Bypass browser CORS and HTTPS mixed content limits
    router.post('/manual_sync', async (req, res) => {
        const peerIp = req.body.targetIp;
        if (!peerIp) return res.status(400).json({ error: 'Missing targetIp' });

        // SSRF Protection: a real IPv4 LAN literal, not a prefix match.
        if (!isPrivateIp(peerIp)) {
            return res.status(400).json({ error: 'Invalid peer IP: must be a private network address' });
        }

        try {
            const fetch = require('node-fetch').default || require('node-fetch');
            const myPackets = getSpoolPackets();
            const myKnownIds = myPackets.map(p => p.id);

            let stats = { received: 0, sent: 0 };

            const https = require('https');
            const agent = new https.Agent({ rejectUnauthorized: false }); // Ignore self-signed certs

            const peerPort = safePort(config.httpsPort, 8443);
            const checkPath = '/api/dtn/sync/check';
            const targetUrl = `https://${peerIp}:${peerPort}${checkPath}`;
            console.log(`\x1b[33m[DTN Proxy] Initiating manual HTTPS fetch to: ${targetUrl}\x1b[0m`);

            // Tell peer what we KNOW.
            const checkBody = JSON.stringify({ known_ids: myKnownIds });
            const checkRes = await fetch(targetUrl, {
                method: 'POST',
                headers: signedHeaders('POST', checkPath, checkBody, { 'Content-Type': 'application/json' }),
                body: checkBody,
                timeout: 5000,
                agent: agent
            });
            if (!checkRes.ok) {
                throw new Error(`Peer rejected sync check (HTTP ${checkRes.status})`);
            }
            const data = await checkRes.json();

            // Store missing payloads peer sent us
            if (data.payloads_for_you && data.payloads_for_you.length > 0) {
                for (const p of data.payloads_for_you) {
                    if (savePacket(p)) stats.received++;
                }
            }

            // Figure out what they need from us
            if (data.my_known_ids) {
                const peerNeeds = myPackets.filter(myP => !data.my_known_ids.includes(myP.id));
                if (peerNeeds.length > 0) {
                    const receivePath = '/api/dtn/sync/receive';
                    const receiveBody = JSON.stringify({ packets: peerNeeds });
                    await fetch(`https://${peerIp}:${peerPort}${receivePath}`, {
                        method: 'POST',
                        headers: signedHeaders('POST', receivePath, receiveBody, { 'Content-Type': 'application/json' }),
                        body: receiveBody,
                        timeout: 5000,
                        agent: agent
                    });
                    stats.sent = peerNeeds.length;
                }
            }

            if (stats.sent > 0 || stats.received > 0) {
                meshLogger.log(`Manual Sync: Sent ${stats.sent}, Received ${stats.received} with ${peerIp}`);
            }

            res.json({ success: true, message: `Sync Complete: Sent ${stats.sent}, Received ${stats.received}` });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Exposed so the background auto-sync loop in server.js reuses exactly this
    // logic. It previously kept its own copy that skipped the size and spool
    // caps and did not validate the packet id at all.
    router.savePacket = savePacket;
    router.getSpoolPackets = getSpoolPackets;

    return router;
};
