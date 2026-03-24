/**
 * PQCMail - Generic Content Script
 * Injects a PQC encrypt/decrypt button near any focused <textarea>
 * and auto-detects PQCMail armored blocks in page text.
 */

'use strict';

const INJECTED_ATTR  = 'data-pqcmail-ui';
const ARMORED_HEADER = '-----BEGIN PQCMAIL MESSAGE-----';

// ─── Floating Toolbar ─────────────────────────────────────────────────────────

let floatingBar = null;
let activeTextarea = null;

function getOrCreateFloatingBar() {
  if (floatingBar) return floatingBar;

  floatingBar = document.createElement('div');
  floatingBar.id = 'pqcmail-floating-bar';
  floatingBar.setAttribute('role', 'toolbar');
  floatingBar.innerHTML = `
    <div class="pqcmail-bar-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
      PQCMail
    </div>
    <button class="pqcmail-bar-btn" id="pqcmail-encrypt-btn" title="Encrypt with Post-Quantum Cryptography">
      🔒 Encrypt
    </button>
    <button class="pqcmail-bar-btn pqcmail-bar-btn--secondary" id="pqcmail-decrypt-btn" title="Decrypt PQCMail message">
      🔓 Decrypt
    </button>
    <button class="pqcmail-bar-close" id="pqcmail-close-btn" title="Dismiss">✕</button>
  `;

  floatingBar.querySelector('#pqcmail-encrypt-btn').addEventListener('click', handleEncrypt);
  floatingBar.querySelector('#pqcmail-decrypt-btn').addEventListener('click', handleDecrypt);
  floatingBar.querySelector('#pqcmail-close-btn').addEventListener('click', () => hideBar());

  document.body.appendChild(floatingBar);
  return floatingBar;
}

function showBar(textarea) {
  activeTextarea = textarea;
  const bar  = getOrCreateFloatingBar();
  const rect = textarea.getBoundingClientRect();

  const top  = window.scrollY + rect.top - bar.offsetHeight - 8;
  const left = window.scrollX + rect.left;

  bar.style.top  = `${Math.max(4, top)}px`;
  bar.style.left = `${Math.min(left, window.innerWidth - 320)}px`;
  bar.classList.add('pqcmail-bar--visible');

  // Show decrypt button only if content looks like PQCMail ciphertext
  const decryptBtn = bar.querySelector('#pqcmail-decrypt-btn');
  decryptBtn.style.display = textarea.value?.includes(ARMORED_HEADER) ? '' : 'none';
}

function hideBar() {
  floatingBar?.classList.remove('pqcmail-bar--visible');
  activeTextarea = null;
}

// ─── Encrypt / Decrypt Handlers ───────────────────────────────────────────────

async function handleEncrypt() {
  if (!activeTextarea) return;

  const plaintext = activeTextarea.value?.trim() || activeTextarea.innerText?.trim();
  if (!plaintext) { showToast('Nothing to encrypt', 'warn'); return; }

  // Ask popup for recipient via a quick prompt overlay
  const recipientEmail = await promptRecipient();
  if (!recipientEmail) return;

  showToast('Encrypting…', 'info');

  const response = await browser.runtime.sendMessage({
    type: 'pqcmail:encrypt_request',
    data: {
      plaintext,
      recipientEmails: [recipientEmail],
      senderEmail: null,
    },
  });

  if (!response.success) {
    showToast(`Encryption failed: ${response.error}`, 'error');
    return;
  }

  if (activeTextarea.tagName === 'TEXTAREA' || activeTextarea.tagName === 'INPUT') {
    activeTextarea.value = response.armored;
    activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    activeTextarea.innerText = response.armored;
  }

  showToast('Encrypted with PQC ✓', 'success');
  hideBar();
}

async function handleDecrypt() {
  if (!activeTextarea) return;

  const armored = activeTextarea.value?.trim() || activeTextarea.innerText?.trim();
  if (!armored?.includes(ARMORED_HEADER)) { showToast('No PQCMail block found', 'warn'); return; }

  const identitiesResp = await browser.runtime.sendMessage({ type: 'pqcmail:get_identities' });
  const identities = identitiesResp?.identities || [];

  if (identities.length === 0) {
    showToast('No PQC identity found. Create one in PQCMail options.', 'error');
    return;
  }

  const recipientEmail = identities.length === 1
    ? identities[0].email
    : await promptSelect('Select your identity', identities.map(i => i.email));

  if (!recipientEmail) return;

  showToast('Decrypting…', 'info');

  const response = await browser.runtime.sendMessage({
    type: 'pqcmail:decrypt_request',
    data: { armored, recipientEmail },
  });

  if (!response.success) {
    showToast(`Decryption failed: ${response.error}`, 'error');
    return;
  }

  showDecryptedOverlay(activeTextarea, response);
  hideBar();
}

// ─── Recipient Prompt (mini modal) ───────────────────────────────────────────

function promptRecipient() {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'pqcmail-modal-backdrop';
    modal.innerHTML = `
      <div class="pqcmail-modal">
        <h3 class="pqcmail-modal-title">🔒 Encrypt with PQCMail</h3>
        <label class="pqcmail-modal-label">Recipient email address</label>
        <input class="pqcmail-modal-input" type="email" placeholder="recipient@example.com" autofocus />
        <div class="pqcmail-modal-actions">
          <button class="pqcmail-modal-btn pqcmail-modal-btn--primary" id="pm-ok">Encrypt</button>
          <button class="pqcmail-modal-btn" id="pm-cancel">Cancel</button>
        </div>
      </div>
    `;

    const input = modal.querySelector('input');
    modal.querySelector('#pm-ok').addEventListener('click', () => {
      modal.remove();
      resolve(input.value.trim() || null);
    });
    modal.querySelector('#pm-cancel').addEventListener('click', () => {
      modal.remove(); resolve(null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { modal.remove(); resolve(input.value.trim() || null); }
      if (e.key === 'Escape') { modal.remove(); resolve(null); }
    });

    document.body.appendChild(modal);
    setTimeout(() => input.focus(), 50);
  });
}

function promptSelect(title, options) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'pqcmail-modal-backdrop';
    const optHtml = options.map(o =>
      `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    modal.innerHTML = `
      <div class="pqcmail-modal">
        <h3 class="pqcmail-modal-title">${escapeHtml(title)}</h3>
        <select class="pqcmail-modal-input">${optHtml}</select>
        <div class="pqcmail-modal-actions">
          <button class="pqcmail-modal-btn pqcmail-modal-btn--primary" id="pm-ok">OK</button>
          <button class="pqcmail-modal-btn" id="pm-cancel">Cancel</button>
        </div>
      </div>
    `;
    const sel = modal.querySelector('select');
    modal.querySelector('#pm-ok').addEventListener('click', () => { modal.remove(); resolve(sel.value); });
    modal.querySelector('#pm-cancel').addEventListener('click', () => { modal.remove(); resolve(null); });
    document.body.appendChild(modal);
  });
}

// ─── Decrypted overlay ────────────────────────────────────────────────────────

function showDecryptedOverlay(originalEl, result) {
  const overlay = document.createElement('div');
  overlay.className = 'pqcmail-decrypted-overlay';
  overlay.innerHTML = `
    <div class="pqcmail-decrypted-header">
      ${result.verified
        ? `<span class="pqcmail-sig-ok">✓ Verified — signed by ${escapeHtml(result.sender)}</span>`
        : `<span class="pqcmail-sig-unknown">⚠ No signature verification</span>`}
      <button class="pqcmail-overlay-close">✕ Close</button>
    </div>
    <div class="pqcmail-decrypted-body">${escapeHtml(result.plaintext)}</div>
  `;
  overlay.querySelector('.pqcmail-overlay-close').addEventListener('click', () => overlay.remove());
  originalEl.insertAdjacentElement('afterend', overlay);
  showToast('Decrypted ✓', 'success');
}

// ─── Auto-scan: detect armored blocks in static page content ─────────────────

function scanForArmoredBlocks() {
  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT,
    { acceptNode: n => n.textContent.includes(ARMORED_HEADER)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP }
  );

  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  nodes.forEach(textNode => {
    const parent = textNode.parentElement;
    if (!parent || parent.hasAttribute(INJECTED_ATTR)) return;
    parent.setAttribute(INJECTED_ATTR, '1');

    const badge = document.createElement('span');
    badge.className = 'pqcmail-inline-badge';
    badge.innerHTML = `🔒 <a href="#" class="pqcmail-inline-decrypt">Decrypt PQCMail message</a>`;
    badge.querySelector('a').addEventListener('click', async e => {
      e.preventDefault();
      const armored = textNode.textContent.trim();
      const identitiesResp = await browser.runtime.sendMessage({ type: 'pqcmail:get_identities' });
      const identities = identitiesResp?.identities || [];
      if (!identities.length) { showToast('No PQC identity configured', 'error'); return; }

      const email = identities[0].email;
      const response = await browser.runtime.sendMessage({
        type: 'pqcmail:decrypt_request',
        data: { armored, recipientEmail: email },
      });

      if (response.success) {
        parent.innerHTML = `<div class="pqcmail-decrypted-inline">${escapeHtml(response.plaintext)}</div>`;
        badge.remove();
      } else {
        showToast(response.error, 'error');
      }
    });

    parent.insertAdjacentElement('afterbegin', badge);
  });
}

// ─── Focus listeners on textareas ────────────────────────────────────────────

document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.tagName === 'TEXTAREA' || (el.contentEditable === 'true' && el.tagName !== 'BODY')) {
    showBar(el);
  }
}, true);

document.addEventListener('focusout', e => {
  setTimeout(() => {
    if (!floatingBar?.contains(document.activeElement)) hideBar();
  }, 150);
}, true);

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const t = document.createElement('div');
  t.className = `pqcmail-toast pqcmail-toast--${type}`;
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('pqcmail-toast--visible'));
  setTimeout(() => { t.classList.remove('pqcmail-toast--visible'); setTimeout(() => t.remove(), 300); }, 3000);
}

function escapeHtml(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

scanForArmoredBlocks();
new MutationObserver(() => scanForArmoredBlocks())
  .observe(document.body, { childList: true, subtree: true });

console.log('[PQCMail] Generic injector active');
