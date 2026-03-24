/**
 * PQCMail - Gmail Content Script
 * Detects Gmail compose windows and read panes, injects PQCMail buttons.
 */

'use strict';

const PQCMAIL_ATTR  = 'data-pqcmail-injected';
const CHECK_INTERVAL = 800; // ms

// ─── DOM Utilities ────────────────────────────────────────────────────────────

function isGmail() {
  return location.hostname === 'mail.google.com';
}

function getComposeBoxes() {
  // Gmail compose: div[role="textbox"][aria-label*="Body"]
  return document.querySelectorAll(
    'div[role="textbox"][aria-label*="Message Body"], ' +
    'div[role="textbox"][g_editable="true"]'
  );
}

function getToolbarForCompose(textbox) {
  // Walk up to find the compose container, then find its toolbar
  let el = textbox;
  for (let i = 0; i < 10; i++) {
    el = el.parentElement;
    if (!el) return null;
    const toolbar = el.querySelector('div[gh="mtb"]');
    if (toolbar) return toolbar;
  }
  return null;
}

function getEmailBodyContainers() {
  // Email read view: div[data-message-id] containing the body
  return document.querySelectorAll(
    'div.a3s.aiL, div[data-message-id] .ii.gt div'
  );
}

// ─── Button Factory ───────────────────────────────────────────────────────────

function makePQCButton(label, iconSvg, onClick) {
  const btn = document.createElement('div');
  btn.className = 'pqcmail-btn';
  btn.title = label;
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.innerHTML = `<span class="pqcmail-btn-icon">${iconSvg}</span><span class="pqcmail-btn-label">${label}</span>`;
  btn.addEventListener('click', onClick);
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') onClick(e); });
  return btn;
}

const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const UNLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;

// ─── Compose Injection ────────────────────────────────────────────────────────

function injectComposeButton(textbox) {
  if (textbox.hasAttribute(PQCMAIL_ATTR)) return;
  textbox.setAttribute(PQCMAIL_ATTR, '1');

  const toolbar = getToolbarForCompose(textbox);
  if (!toolbar) return;

  const btn = makePQCButton('Encrypt with PQC', LOCK_SVG, () => handleEncryptCompose(textbox));
  btn.classList.add('pqcmail-compose-btn');
  toolbar.insertBefore(btn, toolbar.firstChild);
}

async function handleEncryptCompose(textbox) {
  const plaintext = textbox.innerText.trim();
  if (!plaintext) {
    showToast('Write your message first', 'warn');
    return;
  }

  // Get recipients from Gmail TO field
  const recipients = getGmailRecipients();
  if (recipients.length === 0) {
    showToast('Add at least one recipient', 'warn');
    return;
  }

  // Get sender email
  const sender = getGmailSender();

  showToast('Encrypting…', 'info');

  const response = await browser.runtime.sendMessage({
    type: 'pqcmail:encrypt_request',
    data: { plaintext, recipientEmails: recipients, senderEmail: sender },
  });

  if (!response.success) {
    showToast(`Encryption failed: ${response.error}`, 'error');
    return;
  }

  // Replace compose body with armored ciphertext
  textbox.innerText = response.armored;
  // Move cursor to end
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(textbox);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  showToast('Message encrypted with PQC ✓', 'success');
}

function getGmailRecipients() {
  const chips = document.querySelectorAll('div[data-hovercard-id], span[email]');
  const emails = [];
  chips.forEach(el => {
    const email = el.getAttribute('data-hovercard-id') || el.getAttribute('email');
    if (email && email.includes('@')) emails.push(email);
  });
  return [...new Set(emails)];
}

function getGmailSender() {
  // Try to get the "from" address selected in compose
  const fromEl = document.querySelector('span.fX[email], span[data-hovercard-id].fW');
  return fromEl?.getAttribute('email') || fromEl?.getAttribute('data-hovercard-id') || null;
}

// ─── Read View Injection ──────────────────────────────────────────────────────

function injectDecryptButton(container) {
  if (container.hasAttribute(PQCMAIL_ATTR)) return;

  const text = container.innerText || '';
  if (!text.includes('-----BEGIN PQCMAIL MESSAGE-----')) return;

  container.setAttribute(PQCMAIL_ATTR, '1');

  const bar = document.createElement('div');
  bar.className = 'pqcmail-decrypt-bar';
  bar.innerHTML = `
    <span class="pqcmail-badge">🔒 PQCMail Encrypted</span>
    <button class="pqcmail-decrypt-btn">Decrypt</button>
  `;

  bar.querySelector('.pqcmail-decrypt-btn').addEventListener('click', () =>
    handleDecryptMessage(container, bar)
  );

  container.insertAdjacentElement('beforebegin', bar);
}

async function handleDecryptMessage(container, bar) {
  const armored = container.innerText.trim();
  // Identify which account is active
  const recipientEmail = getActiveGmailAccount();

  if (!recipientEmail) {
    showToast('Could not identify your Gmail account', 'error');
    return;
  }

  bar.querySelector('.pqcmail-decrypt-btn').textContent = 'Decrypting…';

  const response = await browser.runtime.sendMessage({
    type: 'pqcmail:decrypt_request',
    data: { armored, recipientEmail },
  });

  if (!response.success) {
    bar.querySelector('.pqcmail-decrypt-btn').textContent = 'Decrypt';
    showToast(`Decryption failed: ${response.error}`, 'error');
    return;
  }

  // Replace ciphertext with plaintext in a styled overlay
  const overlay = document.createElement('div');
  overlay.className = 'pqcmail-plaintext-overlay';
  overlay.innerHTML = `
    <div class="pqcmail-plaintext-header">
      ${response.verified
        ? `<span class="pqcmail-sig-ok">✓ Verified signature from ${response.sender}</span>`
        : `<span class="pqcmail-sig-unknown">⚠ Signature not verified</span>`}
    </div>
    <div class="pqcmail-plaintext-body">${escapeHtml(response.plaintext)}</div>
  `;

  container.replaceWith(overlay);
  bar.remove();
  showToast('Decrypted successfully', 'success');
}

function getActiveGmailAccount() {
  // Gmail stores the active account email in the page title or specific elements
  const accountEl = document.querySelector('a[aria-label*="Google Account"]');
  if (accountEl) {
    const match = accountEl.getAttribute('aria-label')?.match(/[\w.+-]+@[\w.-]+/);
    if (match) return match[0];
  }
  // Fallback: look at the URL hash (#inbox/...)
  const urlMatch = location.href.match(/accounts\.google\.com.*?\/([^/]+@[^/]+)/);
  if (urlMatch) return urlMatch[1];
  return null;
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const existing = document.querySelector('.pqcmail-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `pqcmail-toast pqcmail-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('pqcmail-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('pqcmail-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

// ─── MutationObserver – Watch for new compose / read panes ───────────────────

function scanDom() {
  if (!isGmail()) return;

  getComposeBoxes().forEach(injectComposeButton);
  getEmailBodyContainers().forEach(injectDecryptButton);
}

const observer = new MutationObserver(() => scanDom());

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan + periodic fallback
scanDom();
setInterval(scanDom, CHECK_INTERVAL);

console.log('[PQCMail] Gmail injector active');
