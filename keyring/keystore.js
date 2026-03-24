/**
 * PQCMail – KeyStore
 * Manages PQC key pairs in browser.storage.local.
 *
 * Schema per entry:
 * {
 *   email, algo, sigAlgo,
 *   publicKey, privateKey,         ← base64, privateKey may be AES-encrypted
 *   sigPublicKey, sigPrivateKey,
 *   fingerprint,
 *   trust: 'ultimate'|'full'|'marginal'|'unknown',
 *   source: 'local'|'pqcserver'|'imported',
 *   encrypted: boolean,
 *   createdAt, updatedAt, publishedAt
 * }
 */

'use strict';

const STORAGE_KEY = 'pqcmail_keyring_v1';

// ─── PBKDF2 / AES-GCM private-key protection ─────────────────────────────────

const PrivKeyEnc = {
  async encrypt(b64, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key  = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(b64));
    const out = new Uint8Array(28 + ct.byteLength);
    out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(ct), 28);
    return btoa(String.fromCharCode(...out));
  },

  async decrypt(packed64, passphrase) {
    const buf  = Uint8Array.from(atob(packed64), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key  = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: buf.slice(0, 16), iterations: 250_000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(16, 28) }, key, buf.slice(28));
    return new TextDecoder().decode(plain);
  },
};

// ─── KeyStore ─────────────────────────────────────────────────────────────────

const KeyStore = {

  async _load() {
    const d = await browser.storage.local.get(STORAGE_KEY);
    return d[STORAGE_KEY] || {};
  },

  async _save(kr) {
    await browser.storage.local.set({ [STORAGE_KEY]: kr });
  },

  async getAll()          { return this._load(); },
  async getByEmail(email) { return (await this._load())[email.toLowerCase()] || null; },

  async save(email, data) {
    const kr  = await this._load();
    const now = Date.now();
    const ex  = kr[email.toLowerCase()] || {};
    kr[email.toLowerCase()] = { ...ex, ...data, email: email.toLowerCase(), updatedAt: now, createdAt: ex.createdAt || now };
    await this._save(kr);
    return kr[email.toLowerCase()];
  },

  async remove(email) {
    const kr = await this._load();
    delete kr[email.toLowerCase()];
    await this._save(kr);
  },

  async getIdentities() {
    const kr = await this._load();
    return Object.values(kr)
      .filter(k => k.privateKey)
      .map(({ email, algo, sigAlgo, fingerprint, createdAt, trust, publishedAt }) =>
        ({ email, algo, sigAlgo, fingerprint, createdAt, trust: trust || 'ultimate', publishedAt: publishedAt || null }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  async getContacts() {
    const kr = await this._load();
    return Object.values(kr)
      .filter(k => !k.privateKey)
      .sort((a, b) => a.email < b.email ? -1 : 1);
  },

  async setTrust(email, trust) {
    const kr  = await this._load();
    const key = kr[email.toLowerCase()];
    if (!key) throw new Error(`Key not found: ${email}`);
    Object.assign(key, { trust, updatedAt: Date.now() });
    await this._save(kr);
  },

  async encryptPrivateKeys(email, passphrase) {
    const kr  = await this._load();
    const key = kr[email.toLowerCase()];
    if (!key)         throw new Error(`Key not found: ${email}`);
    if (key.encrypted) throw new Error('Already encrypted');
    key.privateKey    = await PrivKeyEnc.encrypt(key.privateKey, passphrase);
    key.sigPrivateKey = await PrivKeyEnc.encrypt(key.sigPrivateKey, passphrase);
    key.encrypted     = true;
    key.updatedAt     = Date.now();
    await this._save(kr);
  },

  async decryptPrivateKeys(email, passphrase) {
    const key = await this.getByEmail(email);
    if (!key) throw new Error(`Key not found: ${email}`);
    if (!key.encrypted) return { privateKey: key.privateKey, sigPrivateKey: key.sigPrivateKey };
    const [pk, sk] = await Promise.all([
      PrivKeyEnc.decrypt(key.privateKey, passphrase),
      PrivKeyEnc.decrypt(key.sigPrivateKey, passphrase),
    ]);
    return { privateKey: pk, sigPrivateKey: sk };
  },

  async exportFull() {
    return { version: '0.1', exportedAt: Date.now(), keyring: await this._load() };
  },

  async exportPublic() {
    const kr = await this._load();
    const safe = {};
    for (const [e, k] of Object.entries(kr)) {
      safe[e] = { email: k.email, algo: k.algo, sigAlgo: k.sigAlgo, publicKey: k.publicKey,
        sigPublicKey: k.sigPublicKey, fingerprint: k.fingerprint, trust: k.trust,
        source: k.source, createdAt: k.createdAt };
    }
    return { version: '0.1', exportedAt: Date.now(), keyring: safe };
  },

  async importData(data, mode = 'merge') {
    if (!data?.keyring) throw new Error('Invalid keyring export');
    const kr = mode === 'replace' ? {} : await this._load();
    for (const [e, entry] of Object.entries(data.keyring)) {
      const ex = kr[e];
      kr[e] = ex?.privateKey && !entry.privateKey
        ? { ...entry, privateKey: ex.privateKey, sigPrivateKey: ex.sigPrivateKey }
        : { ...entry, source: entry.source || 'imported', updatedAt: Date.now() };
    }
    await this._save(kr);
    return Object.keys(data.keyring).length;
  },

  async stats() {
    const all = Object.values(await this._load());
    return {
      total:      all.length,
      identities: all.filter(k => k.privateKey).length,
      contacts:   all.filter(k => !k.privateKey).length,
      published:  all.filter(k => k.publishedAt).length,
    };
  },
};

// Export for use in service_worker.js (non-module context uses global)
if (typeof module !== 'undefined') module.exports = { KeyStore };
else self.KeyStore = KeyStore;
