/**
 * PQCMail – Background Service Worker
 * Self-contained, no build step needed.
 */
'use strict';

const PQCSERVER_BASE = 'https://api.pqcserver.com/v1';
const KR_KEY = 'pqcmail_keyring_v1';

// ─── Crypto Worker ────────────────────────────────────────────────────────────
let _worker = null, _ready = false, _seq = 0;
const _pending = new Map();

function getWorker() {
  if (_worker) return _worker;
  _worker = new Worker(browser.runtime.getURL('crypto/pqc_worker.js'));
  _worker.onmessage = ({ data }) => {
    if (data.type === 'pqcmail:ready') { _ready = true; return; }
    const cb = _pending.get(data.id);
    if (!cb) return;
    _pending.delete(data.id);
    data.error ? cb.reject(new Error(data.error)) : cb.resolve(data.result);
  };
  _worker.onerror = e => console.error('[PQCMail]', e);
  return _worker;
}

function wCall(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    _pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload });
  });
}

// ─── KeyStore (browser.storage.local) ────────────────────────────────────────
const KS = {
  async _get() { return (await browser.storage.local.get(KR_KEY))[KR_KEY] || {}; },
  async _set(kr) { await browser.storage.local.set({ [KR_KEY]: kr }); },
  async getByEmail(e) { return (await this._get())[e.toLowerCase()] || null; },
  async save(email, data) {
    const kr = await this._get();
    kr[email.toLowerCase()] = { ...data, updatedAt: Date.now() };
    await this._set(kr);
  },
  async remove(email) {
    const kr = await this._get(); delete kr[email.toLowerCase()]; await this._set(kr);
  },
  async getAll() { return this._get(); },
  async getIdentities() {
    const kr = await this._get();
    return Object.entries(kr)
      .filter(([, v]) => v.privateKey)
      .map(([email, v]) => ({ email, algo: v.algo, sigAlgo: v.sigAlgo, fingerprint: v.fingerprint, createdAt: v.createdAt }));
  },
};

// ─── PQCServer API ────────────────────────────────────────────────────────────
const API = {
  async lookup(email) {
    try {
      const r = await fetch(`${PQCSERVER_BASE}/keys/lookup?email=${encodeURIComponent(email)}`);
      return r.ok ? r.json() : null;
    } catch { return null; }
  },
  async publish(email, publicKey, algo, sigPublicKey, sigAlgo) {
    const r = await fetch(`${PQCSERVER_BASE}/keys/publish`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, publicKey, algo, sigPublicKey, sigAlgo }),
    });
    if (!r.ok) throw new Error(`PQCServer ${r.status}`);
    return r.json();
  },
  async ping() {
    try { return (await fetch(`${PQCSERVER_BASE}/ping`, { signal: AbortSignal.timeout(3000) })).ok; }
    catch { return false; }
  },
};

// ─── ASCII Armor ──────────────────────────────────────────────────────────────
const Armor = {
  H: '-----BEGIN PQCMAIL MESSAGE-----',
  F: '-----END PQCMAIL MESSAGE-----',
  wrap(payload, meta = {}) {
    const m = Object.entries(meta).map(([k,v]) => `${k}: ${v}`).join('\n');
    const b = btoa(JSON.stringify(payload)).match(/.{1,64}/g).join('\n');
    return `${this.H}\n${m}\n\n${b}\n${this.F}`;
  },
  unwrap(text) {
    const lines = text.split('\n');
    const si = lines.indexOf(this.H), ei = lines.indexOf(this.F);
    if (si<0||ei<0) throw new Error('Invalid PQCMail armor');
    const meta = {}; let bi = si+1;
    for (let i=si+1; i<ei; i++) {
      if (!lines[i].trim()) { bi=i+1; break; }
      const [k,...v] = lines[i].split(':'); meta[k.trim()] = v.join(':').trim();
    }
    return { meta, payload: JSON.parse(atob(lines.slice(bi,ei).join(''))) };
  },
  is: t => t.includes('-----BEGIN PQCMAIL MESSAGE-----'),
};

// ─── Message Handler ──────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { type, data } = msg;

  (async () => {
    switch (type) {

      case 'pqcmail:keygen_request': {
        const { email, kemAlgo='ml-kem-768', sigAlgo='ml-dsa-65' } = data;
        const [kem, sig] = await Promise.all([
          wCall('keygen-kem', { algo: kemAlgo }),
          wCall('keygen-sig', { algo: sigAlgo }),
        ]);
        await KS.save(email, {
          email, algo: kemAlgo, sigAlgo,
          publicKey: kem.publicKey, privateKey: kem.privateKey,
          sigPublicKey: sig.publicKey, sigPrivateKey: sig.privateKey,
          fingerprint: kem.fingerprint, createdAt: Date.now(),
        });
        return { success: true, fingerprint: kem.fingerprint };
      }

      case 'pqcmail:encrypt_request': {
        const { plaintext, recipientEmails, senderEmail } = data;
        const senderKey = senderEmail ? await KS.getByEmail(senderEmail) : null;
        const blocks = [];
        for (const email of recipientEmails) {
          let key = await KS.getByEmail(email);
          if (!key) { const r = await API.lookup(email); if (r) { await KS.save(email,r); key=r; } }
          if (!key) throw new Error(`No PQC key for ${email}`);
          const enc = await wCall('encrypt', {
            plaintext,
            recipientPublicKey: key.publicKey,
            senderSigPrivateKey: senderKey?.sigPrivateKey || null,
            kemAlgo: key.algo || 'ml-kem-768',
            sigAlgo: senderKey?.sigAlgo || 'ml-dsa-65',
          });
          blocks.push({ email, enc });
        }
        const payload = blocks.length===1 ? blocks[0].enc : { multi:true, blocks };
        return { success: true, armored: Armor.wrap(payload, {
          Version:'PQCMail/0.1', KEM: payload.kemAlgo||'ml-kem-768',
          Recipients: recipientEmails.join(', '), From: senderEmail||'',
        })};
      }

      case 'pqcmail:decrypt_request': {
        const { armored, recipientEmail } = data;
        if (!Armor.is(armored)) throw new Error('Not a PQCMail message');
        const { meta, payload } = Armor.unwrap(armored);
        const recipKey = await KS.getByEmail(recipientEmail);
        if (!recipKey?.privateKey) throw new Error(`No private key for ${recipientEmail}`);
        let senderKey = null;
        if (meta.From) {
          senderKey = await KS.getByEmail(meta.From);
          if (!senderKey) { const r = await API.lookup(meta.From); if (r) { await KS.save(meta.From,r); senderKey=r; } }
        }
        const block = payload.multi
          ? payload.blocks.find(b => b.email.toLowerCase()===recipientEmail.toLowerCase())?.enc
          : payload;
        if (!block) throw new Error('No block for this recipient');
        const result = await wCall('decrypt', {
          payload: block,
          recipientPrivateKey: recipKey.privateKey,
          senderSigPublicKey: senderKey?.sigPublicKey || null,
        });
        return { success:true, ...result, sender: meta.From, meta };
      }

      case 'pqcmail:lookup_key': {
        const local = await KS.getByEmail(data.email);
        if (local) return { source:'local', key:local };
        const remote = await API.lookup(data.email);
        if (remote) { await KS.save(data.email, remote); return { source:'pqcserver', key:remote }; }
        return { source:null, key:null };
      }

      case 'pqcmail:publish_key': {
        const key = await KS.getByEmail(data.email);
        if (!key) throw new Error('No local key');
        const res = await API.publish(data.email, key.publicKey, key.algo, key.sigPublicKey, key.sigAlgo);
        return { success:true, ...res };
      }

      case 'pqcmail:get_identities':
        return { identities: await KS.getIdentities() };

      case 'pqcmail:delete_key':
        await KS.remove(data.email); return { success:true };

      case 'pqcmail:get_status': {
        const [online, ids] = await Promise.all([API.ping(), KS.getIdentities()]);
        return { workerReady:_ready, serverOnline:online, identityCount:ids.length,
                 version: browser.runtime.getManifest().version };
      }

      case 'pqcmail:export_keyring': {
        const kr = await KS.getAll();
        return { success:true, keyring: kr };
      }

      default: throw new Error(`Unknown: ${type}`);
    }
  })().then(sendResponse).catch(e => sendResponse({ success:false, error:e.message }));
  return true;
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('options/options.html') });
});

getWorker();
