/**
 * PQCMail – Key Exchange Protocol Helpers
 * Sender and Recipient sides of the KEM-based key exchange.
 */
'use strict';

class KeyExchangeSender {
  constructor(workerCallFn, keyStoreFn, pqcServerFn) {
    this._worker    = workerCallFn;
    this._store     = keyStoreFn;
    this._server    = pqcServerFn;
  }

  async encrypt({ plaintext, recipientEmails, senderEmail, algo = 'kyber768' }) {
    const senderEntry   = senderEmail ? await this._store(senderEmail) : null;
    const senderSigPriv = senderEntry?.sigPrivateKey || null;

    const resolved = await Promise.all(recipientEmails.map(e => this._resolveKey(e)));
    const missing  = resolved.filter(r => !r.key).map(r => r.email);
    if (missing.length) throw new Error(`No PQC key found for: ${missing.join(', ')}`);

    const blocks = await Promise.all(resolved.map(async ({ email, key }) => {
      const enc = await this._worker('encrypt', {
        plaintext,
        recipientPublicKey: key.publicKey,
        senderPrivateKey:   senderSigPriv,
        algo:               key.algo || algo,
      });
      return { email, enc, algo: key.algo || algo };
    }));

    const payload = blocks.length === 1
      ? blocks[0].enc
      : { multi: true, blocks: blocks.map(({ email, enc }) => ({ email, enc })) };

    return {
      armored:    this._armor(payload, { 'Version': 'PQCMail/0.1', 'Algo': blocks[0].algo, 'Recipients': recipientEmails.join(', '), 'From': senderEmail || '', 'Date': new Date().toUTCString() }),
      recipients: recipientEmails,
    };
  }

  async _resolveKey(email) {
    const local = await this._store(email);
    if (local) return { email, key: local };
    const remote = await this._server(email);
    return { email, key: remote || null };
  }

  _armor(payload, meta) {
    const m  = Object.entries(meta).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n');
    const b64 = btoa(JSON.stringify(payload)).match(/.{1,76}/g).join('\n');
    return `-----BEGIN PQCMAIL MESSAGE-----\n${m}\n\n${b64}\n-----END PQCMAIL MESSAGE-----`;
  }
}

class KeyExchangeRecipient {
  constructor(workerCallFn, keyStoreFn, pqcServerFn) {
    this._worker = workerCallFn;
    this._store  = keyStoreFn;
    this._server = pqcServerFn;
  }

  async decrypt({ armored, recipientEmail }) {
    const { meta, payload } = this._unarmor(armored);
    const recipEntry = await this._store(recipientEmail);
    if (!recipEntry?.privateKey) throw new Error(`No private key for ${recipientEmail}`);

    let block = payload.multi
      ? payload.blocks.find(b => b.email.toLowerCase() === recipientEmail.toLowerCase())?.enc
      : payload;
    if (!block) throw new Error('No encrypted block for this recipient');

    const senderEmail = meta['From'];
    let senderSigPub  = null;
    if (senderEmail) {
      const s = await this._store(senderEmail) || await this._server(senderEmail);
      senderSigPub = s?.sigPublicKey || null;
    }

    const { plaintext, verified } = await this._worker('decrypt', {
      ciphertext: block, recipientPrivateKey: recipEntry.privateKey,
      senderPublicKey: senderSigPub, algo: meta['Algo'] || 'kyber768',
    });

    return { plaintext, verified, sender: senderEmail, meta };
  }

  _unarmor(text) {
    const lines = text.trim().split('\n');
    const si = lines.indexOf('-----BEGIN PQCMAIL MESSAGE-----');
    const ei = lines.indexOf('-----END PQCMAIL MESSAGE-----');
    if (si < 0 || ei < 0) throw new Error('Not a PQCMail message');
    const meta = {};
    let bi = si + 1;
    for (let i = si + 1; i < ei; i++) {
      if (!lines[i].trim()) { bi = i + 1; break; }
      const c = lines[i].indexOf(':');
      if (c > 0) meta[lines[i].slice(0, c).trim()] = lines[i].slice(c + 1).trim();
    }
    return { meta, payload: JSON.parse(atob(lines.slice(bi, ei).join(''))) };
  }
}

if (typeof module !== 'undefined') module.exports = { KeyExchangeSender, KeyExchangeRecipient };
else { self.KeyExchangeSender = KeyExchangeSender; self.KeyExchangeRecipient = KeyExchangeRecipient; }
