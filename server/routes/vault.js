const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let multer;
try { multer = require('multer'); } catch (e) { multer = null; }

module.exports = function (config) {
    const router = express.Router();
    const VAULT_DIR = path.join(__dirname, '..', 'vault_data');
    const VAULT_META = path.join(VAULT_DIR, '.vault_meta.json');
    const ALGORITHM = 'aes-256-gcm';

    // Ensure vault dir exists
    if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

    const activeSessions = new Map(); // token -> { password, expiresAt }

    // ── Unlock throttling ──
    const UNLOCK_ATTEMPTS = new Map();
    const MAX_UNLOCK_ATTEMPTS = 10;
    const UNLOCK_WINDOW_MS = 5 * 60 * 1000;

    function checkUnlockRate(key) {
        const rec = UNLOCK_ATTEMPTS.get(key);
        if (!rec || Date.now() - rec.firstAttempt > UNLOCK_WINDOW_MS) return true;
        return rec.count < MAX_UNLOCK_ATTEMPTS;
    }
    function recordFailedUnlock(key) {
        const rec = UNLOCK_ATTEMPTS.get(key);
        if (!rec || Date.now() - rec.firstAttempt > UNLOCK_WINDOW_MS) {
            UNLOCK_ATTEMPTS.set(key, { count: 1, firstAttempt: Date.now() });
        } else {
            rec.count++;
        }
    }
    function clearFailedUnlocks(key) { UNLOCK_ATTEMPTS.delete(key); }

    function cleanSessions() {
        const now = Date.now();
        for (const [token, data] of activeSessions.entries()) {
            if (data.expiresAt < now) activeSessions.delete(token);
        }
    }

    function loadMeta() {
        if (!fs.existsSync(VAULT_META)) return { files: [], vaultKeyHash: null };
        return JSON.parse(fs.readFileSync(VAULT_META, 'utf-8'));
    }
    function saveMeta(meta) {
        const tmp = `${VAULT_META}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, VAULT_META);
    }

    // ── Key derivation ───────────────────────────────────────────────────
    //
    // v1 (legacy) derived the AES key and the stored password verifier from the
    // same password, salt, iteration count and PRF, differing only in output
    // length. PBKDF2 output is a prefix of the longer output, so the 32-byte
    // encryption key was literally the first 32 bytes of the verifier that sits
    // in .vault_meta.json next to the ciphertext. Reading that file recovered
    // every key.
    //
    // v2 derives one master secret and then splits it with HKDF using distinct
    // info labels, so the verifier reveals nothing about the encryption key.

    const VAULT_VERSION = 2;
    const V1_ITERATIONS = 100000;
    const V2_ITERATIONS = 210000;
    const IV_LEN_V1 = 16;
    const IV_LEN_V2 = 12; // Standard GCM nonce length.

    function deriveKeyV1(password, salt) {
        return crypto.pbkdf2Sync(password, salt, V1_ITERATIONS, 32, 'sha512');
    }

    function hashVaultPasswordV1(password, salt) {
        return crypto.pbkdf2Sync(password, salt, V1_ITERATIONS, 64, 'sha512').toString('hex');
    }

    function deriveMasterV2(password, salt) {
        return crypto.pbkdf2Sync(password, salt, V2_ITERATIONS, 32, 'sha512');
    }

    function hkdf(master, salt, info, length) {
        return Buffer.from(crypto.hkdfSync('sha512', master, Buffer.from(salt, 'hex'), info, length));
    }

    function deriveKeyV2(password, salt) {
        return hkdf(deriveMasterV2(password, salt), salt, 'cyberdeck-vault-encryption', 32);
    }

    function hashVaultPasswordV2(password, salt) {
        return hkdf(deriveMasterV2(password, salt), salt, 'cyberdeck-vault-verifier', 32).toString('hex');
    }

    /** Constant-time hex comparison. */
    function hexEqual(a, b) {
        const bufA = Buffer.from(String(a || ''), 'hex');
        const bufB = Buffer.from(String(b || ''), 'hex');
        if (bufA.length === 0 || bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    /** Version-aware, timing-safe password check. */
    function verifyVaultPassword(meta, password) {
        if (typeof password !== 'string' || !meta || !meta.vaultKeyHash) return false;
        return meta.version === VAULT_VERSION
            ? hexEqual(hashVaultPasswordV2(password, meta.vaultSalt), meta.vaultKeyHash)
            : hexEqual(hashVaultPasswordV1(password, meta.vaultSalt), meta.vaultKeyHash);
    }

    /** Encryption key for the vault's current format. */
    function deriveKey(password, meta) {
        return meta.version === VAULT_VERSION
            ? deriveKeyV2(password, meta.vaultSalt)
            : deriveKeyV1(password, meta.vaultSalt);
    }

    function ivLength(meta) {
        return meta.version === VAULT_VERSION ? IV_LEN_V2 : IV_LEN_V1;
    }

    /**
     * One-time upgrade of a v1 vault: decrypt every file with the old key and
     * re-encrypt under the split-key scheme. Runs on a successful unlock.
     */
    function migrateVaultToV2(meta, password) {
        if (meta.version === VAULT_VERSION) return meta;

        const oldKey = deriveKeyV1(password, meta.vaultSalt);
        const newSalt = crypto.randomBytes(32).toString('hex');
        const newKey = deriveKeyV2(password, newSalt);

        const rewritten = [];
        for (const fileMeta of meta.files || []) {
            const encPath = path.join(VAULT_DIR, fileMeta.id + '.enc');
            if (!fs.existsSync(encPath)) continue;

            const data = fs.readFileSync(encPath);
            const iv = data.subarray(0, IV_LEN_V1);
            const authTag = data.subarray(IV_LEN_V1, IV_LEN_V1 + 16);
            const encrypted = data.subarray(IV_LEN_V1 + 16);

            const decipher = crypto.createDecipheriv(ALGORITHM, oldKey, iv);
            decipher.setAuthTag(authTag);
            const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);

            const newIv = crypto.randomBytes(IV_LEN_V2);
            const cipher = crypto.createCipheriv(ALGORITHM, newKey, newIv);
            const reEncrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
            const out = Buffer.concat([newIv, cipher.getAuthTag(), reEncrypted]);

            // Write to a temp file first so a crash cannot leave a half-written
            // blob that no key can open.
            const tmp = encPath + '.migrating';
            fs.writeFileSync(tmp, out);
            fs.renameSync(tmp, encPath);
            rewritten.push({ ...fileMeta, encSize: out.length });
        }

        meta.files = rewritten;
        meta.vaultSalt = newSalt;
        meta.vaultKeyHash = hashVaultPasswordV2(password, newSalt);
        meta.version = VAULT_VERSION;
        saveMeta(meta);
        console.log(`[Vault] Migrated ${rewritten.length} file(s) to v${VAULT_VERSION} key derivation.`);
        return meta;
    }

    // Initialize vault with a password (first time)
    router.post('/init', (req, res) => {
        const { password } = req.body;
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'Password must be 8+ characters' });
        }

        const meta = loadMeta();
        if (meta.vaultKeyHash) return res.status(400).json({ error: 'Vault already initialized' });

        const vaultSalt = crypto.randomBytes(32).toString('hex');
        meta.vaultSalt = vaultSalt;
        meta.vaultKeyHash = hashVaultPasswordV2(password, vaultSalt);
        meta.version = VAULT_VERSION;
        meta.files = [];
        saveMeta(meta);

        cleanSessions();
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { password, expiresAt: Date.now() + 60 * 60 * 1000 });

        res.json({ success: true, token });
    });

    // Check vault status
    router.get('/status', (req, res) => {
        const meta = loadMeta();
        res.json({
            initialized: !!meta.vaultKeyHash,
            fileCount: meta.files ? meta.files.length : 0,
            totalSize: meta.files ? meta.files.reduce((s, f) => s + (f.encSize || 0), 0) : 0
        });
    });

    // Unlock vault (verify password)
    router.post('/unlock', (req, res) => {
        const { password } = req.body;

        // Key derivation is deliberately expensive and runs on the event loop,
        // so unlock attempts are throttled per client.
        const clientKey = req.ip || 'unknown';
        if (!checkUnlockRate(clientKey)) {
            return res.status(429).json({ error: 'Too many unlock attempts. Try again shortly.' });
        }

        let meta = loadMeta();
        if (!meta.vaultKeyHash) return res.status(400).json({ error: 'Vault not initialized' });

        if (!verifyVaultPassword(meta, password)) {
            recordFailedUnlock(clientKey);
            return res.status(401).json({ error: 'Wrong vault password' });
        }
        clearFailedUnlocks(clientKey);

        try {
            meta = migrateVaultToV2(meta, password);
        } catch (err) {
            console.error('[Vault] Migration failed:', err.message);
            return res.status(500).json({ error: 'Vault migration failed; vault left unchanged' });
        }

        cleanSessions();
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { password, expiresAt: Date.now() + 60 * 60 * 1000 });

        res.json({ success: true, token, files: meta.files.map(f => ({ id: f.id, name: f.name, size: f.originalSize, date: f.date })) });
    });

    // List files using an existing unlock token.
    //
    // The client previously re-POSTed /unlock to refresh the list, sending a
    // field it never set, so the list came back empty after every upload or
    // delete and the vault looked like it had wiped itself.
    router.get('/files', (req, res) => {
        const token = req.headers['x-vault-token'];
        cleanSessions();
        const session = token ? activeSessions.get(token) : null;
        if (!session) return res.status(401).json({ error: 'Vault session expired' });

        session.expiresAt = Date.now() + 60 * 60 * 1000;

        const meta = loadMeta();
        if (!verifyVaultPassword(meta, session.password)) {
            return res.status(401).json({ error: 'Vault config changed' });
        }

        res.json({
            success: true,
            files: (meta.files || []).map(f => ({
                id: f.id, name: f.name, size: f.originalSize, date: f.date
            }))
        });
    });

    // Store a file into vault (using multer for reliable upload)
    const upload = multer ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }) : null;

    const storeHandler = (req, res) => {
        const token = req.headers['x-vault-token'];
        const fileName = req.file ? req.file.originalname : (req.headers['x-file-name'] || 'unnamed');
        if (!token) return res.status(400).json({ error: 'Vault session token required' });

        cleanSessions();
        const session = activeSessions.get(token);
        if (!session) return res.status(401).json({ error: 'Vault session expired' });

        session.expiresAt = Date.now() + 60 * 60 * 1000;
        const vaultPass = session.password;

        const meta = loadMeta();
        if (!verifyVaultPassword(meta, vaultPass)) return res.status(401).json({ error: 'Vault config changed' });

        const fileData = req.file ? req.file.buffer : req.body;
        if (!fileData || fileData.length === 0) return res.status(400).json({ error: 'No file data received' });

        const key = deriveKey(vaultPass, meta);
        const iv = crypto.randomBytes(ivLength(meta));
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        const encrypted = Buffer.concat([cipher.update(fileData), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const fileId = crypto.randomBytes(8).toString('hex');
        const encPath = path.join(VAULT_DIR, fileId + '.enc');

        // Store: iv(16) + authTag(16) + encrypted data
        const output = Buffer.concat([iv, authTag, encrypted]);
        fs.writeFileSync(encPath, output);

        meta.files.push({
            id: fileId,
            name: fileName,
            originalSize: fileData.length,
            encSize: output.length,
            date: new Date().toISOString()
        });
        saveMeta(meta);

        res.json({ success: true, id: fileId });
    };

    if (upload) {
        router.post('/store', upload.single('file'), storeHandler);
    } else {
        router.post('/store', express.raw({ type: '*/*', limit: '100mb' }), storeHandler);
    }

    // Retrieve a file from vault
    router.post('/retrieve/:id', (req, res) => {
        const { token } = req.body;
        cleanSessions();
        const session = activeSessions.get(token);
        if (!session) return res.status(401).json({ error: 'Vault session expired' });

        session.expiresAt = Date.now() + 60 * 60 * 1000;
        const password = session.password;

        const meta = loadMeta();
        if (!verifyVaultPassword(meta, password)) return res.status(401).json({ error: 'Vault config changed' });

        const fileMeta = meta.files.find(f => f.id === req.params.id);
        if (!fileMeta) return res.status(404).json({ error: 'File not found' });

        const encPath = path.join(VAULT_DIR, req.params.id + '.enc');
        if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'Encrypted file missing' });

        const data = fs.readFileSync(encPath);
        const ivLen = ivLength(meta);
        const iv = data.subarray(0, ivLen);
        const authTag = data.subarray(ivLen, ivLen + 16);
        const encrypted = data.subarray(ivLen + 16);

        const key = deriveKey(password, meta);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        try {
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            res.set('Content-Disposition', `attachment; filename="${fileMeta.name}"`);
            res.send(decrypted);
        } catch {
            res.status(500).json({ error: 'Decryption failed' });
        }
    });

    // Delete a file from vault
    router.delete('/:id', (req, res) => {
        const token = req.headers['x-vault-token'];
        cleanSessions();
        const session = activeSessions.get(token);
        if (!session) return res.status(401).json({ error: 'Vault session expired' });

        session.expiresAt = Date.now() + 60 * 60 * 1000;
        const vaultPass = session.password;

        const meta = loadMeta();
        if (!verifyVaultPassword(meta, vaultPass)) return res.status(401).json({ error: 'Vault config changed' });

        const idx = meta.files.findIndex(f => f.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'File not found' });

        const encPath = path.join(VAULT_DIR, req.params.id + '.enc');
        if (fs.existsSync(encPath)) fs.unlinkSync(encPath);

        meta.files.splice(idx, 1);
        saveMeta(meta);
        res.json({ success: true });
    });

    // Change vault password
    router.post('/change-password', (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be 8+ characters' });
        }

        const meta = loadMeta();
        if (!verifyVaultPassword(meta, oldPassword)) {
            return res.status(401).json({ error: 'Wrong current password' });
        }

        // Re-encrypt everything, and take the opportunity to land on v2.
        const oldKey = deriveKey(oldPassword, meta);
        const oldIvLen = ivLength(meta);
        const newSalt = crypto.randomBytes(32).toString('hex');
        const newKey = deriveKeyV2(newPassword, newSalt);

        const updated = [];
        for (const fileMeta of meta.files) {
            const encPath = path.join(VAULT_DIR, fileMeta.id + '.enc');
            if (!fs.existsSync(encPath)) continue;

            const data = fs.readFileSync(encPath);
            const iv = data.subarray(0, oldIvLen);
            const authTag = data.subarray(oldIvLen, oldIvLen + 16);
            const encrypted = data.subarray(oldIvLen + 16);

            // Decrypt with old key
            const decipher = crypto.createDecipheriv(ALGORITHM, oldKey, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

            // Re-encrypt with new key
            const newIv = crypto.randomBytes(IV_LEN_V2);
            const cipher = crypto.createCipheriv(ALGORITHM, newKey, newIv);
            const reEncrypted = Buffer.concat([cipher.update(decrypted), cipher.final()]);
            const out = Buffer.concat([newIv, cipher.getAuthTag(), reEncrypted]);

            const tmp = encPath + '.rekey';
            fs.writeFileSync(tmp, out);
            fs.renameSync(tmp, encPath);
            updated.push({ ...fileMeta, encSize: out.length });
        }

        meta.files = updated;
        meta.vaultSalt = newSalt;
        meta.vaultKeyHash = hashVaultPasswordV2(newPassword, newSalt);
        meta.version = VAULT_VERSION;
        saveMeta(meta);

        // Every cached session holds the old password; force a re-unlock.
        activeSessions.clear();
        res.json({ success: true });
    });

    return router;
};
