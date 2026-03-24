<div align="center">

<img src="icons/icon128.png" width="96" height="96" alt="PQCMail icon"/>

# PQCMail

**Post-Quantum Cryptography for your email — right in Firefox**

[![Firefox](https://img.shields.io/badge/Firefox-140%2B-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/pqcmail/)
[![License: MIT](https://img.shields.io/badge/License-MIT-38bdf8.svg)](LICENSE)
[![NIST FIPS 203](https://img.shields.io/badge/NIST-FIPS%20203%20ML--KEM-10b981)](https://csrc.nist.gov/pubs/fips/203/final)
[![NIST FIPS 204](https://img.shields.io/badge/NIST-FIPS%20204%20ML--DSA-10b981)](https://csrc.nist.gov/pubs/fips/204/final)
[![NIST FIPS 205](https://img.shields.io/badge/NIST-FIPS%20205%20SLH--DSA-10b981)](https://csrc.nist.gov/pubs/fips/205/final)
[![Zero telemetry](https://img.shields.io/badge/Telemetry-Zero-10b981)](https://pqcserver.com/pqcmail/privacy)

*Encrypt and decrypt emails with quantum-resistant algorithms (Kyber, Dilithium, SPHINCS+) directly inside Gmail, Outlook, and any webmail. Like [Mailvelope](https://www.mailvelope.com/) — but for the post-quantum era.*

[**Install on Firefox**](https://addons.mozilla.org/firefox/addon/pqcmail/) · [**PQCServer**](https://pqcserver.com) · [**Privacy Policy**](https://pqcserver.com/pqcmail/privacy) · [**Report a Bug**](https://github.com/pqcserver/pqcmail-addon/issues)

</div>

---

## ✨ Features

- 🔒 **ML-KEM (Kyber768)** — NIST FIPS 203 key encapsulation for encryption
- ✍️ **ML-DSA (Dilithium3)** — NIST FIPS 204 digital signatures for authentication
- 🌿 **SLH-DSA (SPHINCS+)** — NIST FIPS 205 hash-based signatures (different hardness assumption)
- 🔀 **Hybrid X25519 + Kyber768** — transitional mode combining classical + post-quantum security
- 📧 **Gmail, Outlook, Yahoo Mail, OnionMail** — dedicated injectors for major webmail clients
- 📝 **Generic mode** — encrypt any `<textarea>` on any website
- 🗂️ **PQCServer key directory** — publish and discover public keys (analogous to HKP keyservers)
- 🏠 **100% local crypto** — all operations run in a Web Worker on your device
- 🔐 **Keys encrypted at rest** — AES-256-GCM + PBKDF2 (210k iterations)
- 🚫 **Zero telemetry** — no analytics, no tracking, no ads

---

## 📸 Screenshots

<table>
<tr>
<td align="center">
<img src="https://github.com/Onion-Search-Engine/pqcmail-addon/blob/main/docs/screenshot-1-popup.png" width="320" alt="Popup"/>
<br/><sub><b>Popup — active identity</b></sub>
</td>
<td align="center">
<img src="https://github.com/Onion-Search-Engine/pqcmail-addon/blob/main/docs/screenshot-2-encrypt.png" width="320" alt="Encrypt panel"/>
<br/><sub><b>Encrypt message panel</b></sub>
</td>
</tr>
<tr>
<td align="center">
<img src="https://github.com/Onion-Search-Engine/pqcmail-addon/blob/main/docs/screenshot-3-gmail-banner.png" width="320" alt="Gmail banner"/>
<br/><sub><b>Gmail — injected decrypt banner</b></sub>
</td>
<td align="center">
<img src="https://github.com/Onion-Search-Engine/pqcmail-addon/blob/main/docs/screenshot-4-decrypted.png" width="320" alt="Decrypted email"/>
<br/><sub><b>Decrypted email with verified ML-DSA signature</b></sub>
</td>
</tr>
</table>

---

## 🚀 Installation

### From Firefox Add-ons (AMO) — recommended

1. Go to [addons.mozilla.org/firefox/addon/pqcmail](https://addons.mozilla.org/firefox/addon/pqcmail/)
2. Click **Add to Firefox**
3. Accept the permissions
4. The Settings page opens automatically — generate your first key pair

### Manual installation (development)

1. Download the latest `.xpi` from [Releases](https://github.com/pqcserver/pqcmail-addon/releases)
2. Open Firefox → `about:config` → set `xpinstall.signatures.required` to `false`
3. Open `about:addons` → gear icon → **Install Add-on From File**
4. Select the `.xpi` file

---

## 🔑 Quick Start

### 1 — Generate your PQC key pair

Open the PQCMail popup → click **+** next to the identity selector → fill in your email and preferred algorithms → click **Generate Keys**.

Optionally tick **Publish to PQCServer** to make your public key discoverable by anyone using PQCMail.

### 2 — Encrypt an email

Open Gmail (or any supported webmail). The PQCMail **🔒 Encrypt with PQC** button appears in the compose toolbar. Click it, write your message in the secure frame, and click **Encrypt & Insert** — the armored ciphertext is placed in the compose body automatically.

```
-----BEGIN PQCMAIL MESSAGE-----
Version: PQCMail/0.1
KEM: ml-kem-768
Recipients: alice@example.com
From: bob@pqcserver.com

eyJrZW1DdCI6Ii9nQWt3NHZ4T3pBT2xhWkNBY3dWZkN3STVBZ1...
-----END PQCMAIL MESSAGE-----
```

### 3 — Decrypt a received email

When you open an email containing a PQCMail block, a banner **🔒 PQCMail Encrypted** appears automatically. Click **Decrypt** — the plaintext is shown in a sandboxed overlay, along with the signature verification status.

---

## 🏗️ Architecture

```
pqcmail-addon/
├── manifest.json                    # WebExtension MV2 — Firefox 140+
│
├── background/
│   └── service_worker.js            # Core engine: keystore, armor, message routing
│
├── content_scripts/
│   ├── frame_injector.js            # Sandboxed iframe inject (Mailvelope-style)
│   ├── gmail_injector.js            # Gmail-specific compose/read injection
│   ├── webmail_injector.js          # Yahoo · Outlook · OnionMail
│   ├── generic_injector.js          # Any <textarea> on any page
│   └── injector.css                 # Injected UI styles
│
├── crypto/
│   ├── pqc_worker.js                # Web Worker — uses pqc_lib.js
│   └── pqc_lib.js                   # @noble/post-quantum bundled (IIFE, ~85KB)
│
├── popup/
│   ├── popup.html / .css / .js      # Extension popup UI
│   ├── compose_frame.html           # Sandboxed compose iframe
│   └── read_frame.html              # Sandboxed decrypt iframe
│
├── keyring/
│   ├── keystore.js                  # IndexedDB keystore with AES-256-GCM at-rest encryption
│   └── key_exchange.js              # TOFU trust model, fingerprint helpers
│
├── options/
│   └── options.html                 # Settings page (key management, PQCServer config)
│
└── _locales/
    ├── en/messages.json             # English
    └── it/messages.json             # Italian
```

---

## 🔐 Cryptographic Design

### Encryption flow

```
Sender                                          Recipient
──────                                          ─────────

plaintext
    │
    ▼
Kyber768.encapsulate(recipientPublicKey)
    ├── kemCiphertext  ────────────────────────► Kyber768.decapsulate(kemCt, recipientPrivKey)
    └── sharedSecret                                 └── sharedSecret
         │                                                    │
         ▼                                                    ▼
    HKDF-SHA256(sharedSecret)                    HKDF-SHA256(sharedSecret)
         │                                                    │
         ▼                                                    ▼
    AES-256-GCM.encrypt(plaintext, aesKey)       AES-256-GCM.decrypt(ciphertext, aesKey)
         │                                                    │
         ▼                                                    ▼
    ciphertext ─────────────────────────────────────────► plaintext
         │
         ▼
    Dilithium3.sign(kemCt ‖ iv ‖ ciphertext, senderPrivKey)
         │
         ▼
    signature ──────────────────────────────────► Dilithium3.verify(…, senderPubKey) ✓
```

### Hybrid mode (X25519 + Kyber768)

In hybrid mode the final AES key is derived from **both** the classical X25519 shared secret and the Kyber768 shared secret via `HKDF(x25519Secret ‖ kyberSecret)`. This provides security as long as **at least one** of the two algorithms remains unbroken.

### Key storage

Private keys are encrypted at rest inside `browser.storage.local`:

```
masterKey = PBKDF2-SHA256(passphrase, salt, 210_000 iterations)
storedKey = AES-256-GCM.encrypt(privateKey, masterKey)
```

### ASCII armor format

```
-----BEGIN PQCMAIL MESSAGE-----
Version: PQCMail/0.1
KEM: ml-kem-768
Recipients: alice@example.com
From: bob@example.com

<base64(JSON({ kemCt, aesCt, aesIv, signature, kemAlgo, sigAlgo }))>
-----END PQCMAIL MESSAGE-----
```

---

## 🛠️ Development

### Prerequisites

- Firefox 140+
- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/pqcserver/pqcmail-addon.git
cd pqcmail-addon
npm install
```

### Build `crypto/pqc_lib.js`

`pqc_lib.js` is the only file that requires a build step. It bundles `@noble/post-quantum` into a browser-ready IIFE:

```bash
node build.js
# → crypto/pqc_lib.js generated (not minified, ~85KB)
```

All other files (`background/`, `content_scripts/`, `popup/`, `options/`, `keyring/`) are **plain JS/HTML/CSS** — no build step required.

### Load in Firefox

```bash
# Option A: using web-ext (recommended)
npx web-ext run --source-dir .

# Option B: manual
# 1. Open about:debugging → This Firefox
# 2. Load Temporary Add-on → select manifest.json
```

### Package for release

```bash
npx web-ext build --source-dir . --artifacts-dir artifacts
# → artifacts/pqcmail-0.1.0.zip  (rename to .xpi for Firefox)
```

---

## 📦 Dependencies

| Package | Version | License | Purpose |
|---|---|---|---|
| [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum) | 0.5.4 | MIT | ML-KEM, ML-DSA, SLH-DSA implementations |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | 1.7.1 | MIT | SHA-3, SHAKE (required by @noble/post-quantum) |
| [esbuild](https://esbuild.github.io/) | 0.20.2 | MIT | Bundle pqc_lib.js (dev only) |

`@noble/post-quantum` is a **pure JavaScript** implementation — no native binaries, no WebAssembly blobs, fully auditable. See the [audit report](https://github.com/paulmillr/noble-post-quantum#security).

---

## 🌍 PQCServer Integration

PQCMail integrates with **[PQCServer](https://pqcserver.com)**, a public post-quantum key directory analogous to HKP keyservers for PGP.

| Operation | Endpoint | Data transmitted |
|---|---|---|
| Publish key | `POST /v1/keys/publish` | Your **public** key only |
| Lookup key | `GET /v1/keys/lookup?email=…` | Recipient email |
| Connectivity check | `GET /v1/ping` | Nothing |

Private keys are **never** transmitted. PQCServer integration is optional and can be disabled in Settings.

---

## 🗺️ Roadmap

- [ ] **v0.2** — OnionMail SMTP integration (Inbox/Outbox via PQCServer)
- [ ] **v0.2** — Key rotation with forward secrecy notification
- [ ] **v0.3** — 2FA / TOTP for keystore unlock
- [ ] **v0.3** — Audit log of all crypto operations
- [ ] **v0.4** — Canary token support
- [ ] **v0.4** — Password-protected messages (no key lookup required)
- [ ] **v0.5** — REST API + JS/Python SDK
- [ ] **v0.6** — Public Notary Registry
- [ ] **Future** — Chrome/Chromium port (Manifest V3)
- [ ] **Future** — Hardware key support (YubiKey / PKCS#11)
- [ ] **Future** — Firefox Sync for keyring backup

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes — ensure **zero `innerHTML` assignments** (AMO requirement)
4. Test in Firefox: `npx web-ext run --source-dir .`
5. Open a Pull Request

For bug reports and feature requests, please use [GitHub Issues](https://github.com/pqcserver/pqcmail-addon/issues).

### Code style

- Vanilla JS only — no frameworks, no TypeScript (keeps the source auditable)
- All DOM manipulation via `createElement` / `textContent` — never `innerHTML`
- Content Security Policy: `script-src 'self'` — no inline scripts, no CDN

---

## 🔏 Security

If you discover a security vulnerability, please **do not** open a public issue. Instead, email us at:

📧 **security@pqcserver.com**

We aim to respond within 48 hours and will coordinate a responsible disclosure.

---

## 📄 License

MIT — © 2025 PQCServer Project

See [LICENSE](LICENSE) for the full text.

---

<div align="center">

Made with 🔒 by the [PQCServer](https://pqcserver.com) team

*Quantum computers are coming. Your email should be ready.*

</div>
