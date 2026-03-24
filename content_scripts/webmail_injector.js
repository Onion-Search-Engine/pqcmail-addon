/**
 * PQCMail - Generic Webmail Injector
 * Handles Yahoo Mail, Outlook Web, OnionMail, and other webmail clients
 * using heuristic detection of compose / read areas.
 */

'use strict';

// ─── Provider Profiles ────────────────────────────────────────────────────────
// Each profile describes how to find compose boxes, read bodies, and recipients
// on a given webmail provider.

const PROVIDERS = [
  {
    name: 'yahoo',
    match: () => location.hostname.includes('mail.yahoo.com'),
    composeSelector:    'div[data-test-id="compose-editor"] div[contenteditable="true"]',
    readSelector:       'div[data-test-id="message-view-body-content"]',
    recipientSelector:  'li[data-test-id="ymail-chip"] span[data-test-id="email-address"]',
    toolbarSelector:    'div[data-test-id="compose-actions-toolbar"]',
    senderSelector:     null,
  },
  {
    name: 'outlook',
    match: () => location.hostname.includes('outlook.live.com') ||
                 location.hostname.includes('outlook.office.com'),
    composeSelector:    'div[aria-label="Message body"] div[contenteditable="true"]',
    readSelector:       'div[class*="ReadingPane"] div[class*="MessageBody"]',
    recipientSelector:  'div[class*="RecipientWell"] span[class*="Email"]',
    toolbarSelector:    'div[class*="ComposeCommandBar"]',
    senderSelector:     null,
  },
  {
    name: 'onionmail',
    match: () => location.hostname.includes('onionmail.org'),
    composeSelector:    '#composebody, textarea[name="body"]',
    readSelector:       'div.mailContent, div#mail-body',
    recipientSelector:  'input[name="to"]',
    toolbarSelector:    'div.composeToolbar, form#compose-form',
    senderSelector:     'select[name="from"], input[name="from"]',
  },
];

const ARMORED_HEADER = '-----BEGIN PQCMAIL MESSAGE-----';
const INJECTED_ATTR  = 'data-pqcmail-wm';

// ─── Detect Provider ──────────────────────────────────────────────────────────

let currentProvider = null;

function detectProvider() {
  currentProvider = PROVIDERS.find(p => p.match()) || null;
  return currentProvider;
}

// ─── Injection ────────────────────────────────────────────────────────────────

function injectIntoCompose(el, provider) {
  if (el.hasAttribute(INJECTED_ATTR)) return;
  el.setAttribute(INJECTED_ATTR, '1');

  const toolbar = provider.toolbarSelector
    ? (el.closest('form, div[class*="Compose"]')?.querySelector(provider.toolbarSelector)
       || document.querySelector(provider.toolbarSelector))
    : null;

  const btn = makeWebmailButton('🔒 PQC Encrypt', 'pqcmail-wm-encrypt-btn');
  btn.addEventListener('click', () => handleWebmailEncrypt(el, provider));

  if (toolbar) {
    toolbar.insertBefore(btn, toolbar.firstChild);
  } else {
    // Fallback: insert just above the textarea
    const wrapper = document.createElement('div');
    wrapper.className = 'pqcmail-wm-btn-wrapper';
    wrapper.appendChild(btn);
    el.insertAdjacentElement('beforebegin', wrapper);
  }
}

function injectDecryptBanner(el) {
  if (el.hasAttribute(INJECTED_ATTR)) return;
  const text = el.innerText || el.textContent || '';
  if (!text.includes(ARMORED_HEADER)) return;

  el.setAttribute(INJECTED_ATTR, '1');

  const banner = document.createElement('div');
  banner.className = 'pqcmail-decrypt-banner';
  banner.innerHTML = `
    <span>🔒 This message is PQCMail-encrypted</span>
    <button class="pqcmail-decrypt-banner-btn">Decrypt</button>
  `;
  banner.querySelector('button').addEventListener('click', () =>
    handleWebmailDecrypt(el, banner, text)
  );
  el.insertAdjacentElement('beforebegin', banner);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleWebmailEncrypt(el, provider) {
  const plaintext = el.value || el.innerText?.trim();
  if (!plaintext) { showToast('Write a message first', 'warn'); return; }

  const recipients = getWebmailRecipients(provider);
  if (!recipients.length) { showToast('Add at least one recipient', 'warn'); return; }

  const senderEmail = getWebmailSender(provider);
  showToast('Encrypting…', 'info');

  const resp = await browser.runtime.sendMessage({
    type: 'pqcmail:encrypt_request',
    data: { plaintext, recipientEmails: recipients, senderEmail },
  });

  if (!resp.success) { showToast(`Error: ${resp.error}`, 'error'); return; }

  if (el.tagName === 'TEXTAREA') {
    el.value = resp.armored;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.innerText = resp.armored;
  }
  showToast('Encrypted ✓', 'success');
}

async function handleWebmailDecrypt(el, banner, armoredText) {
  // Find active identity
  const idResp = await browser.runtime.sendMessage({ type: 'pqcmail:get_identities' });
  const ids = idResp?.identities || [];
  if (!ids.length) { showToast('No PQC identity found', 'error'); return; }

  const recipientEmail = ids[0].email;
  banner.querySelector('button').textContent = 'Decrypting…';

  const resp = await browser.runtime.sendMessage({
    type: 'pqcmail:decrypt_request',
    data: { armored: armoredText, recipientEmail },
  });

  if (!resp.success) {
    banner.querySelector('button').textContent = 'Decrypt';
    showToast(resp.error, 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'pqcmail-wm-decrypted';
  overlay.innerHTML = `
    <p class="${resp.verified ? 'pqcmail-sig-ok' : 'pqcmail-sig-unknown'}">
      ${resp.verified ? `✓ Verified signature from ${escapeHtml(resp.sender)}` : '⚠ Signature not verified'}
    </p>
    <div class="pqcmail-wm-plaintext">${escapeHtml(resp.plaintext)}</div>
  `;
  el.replaceWith(overlay);
  banner.remove();
  showToast('Decrypted ✓', 'success');
}

// ─── Extract Recipients / Sender ──────────────────────────────────────────────

function getWebmailRecipients(provider) {
  const emails = [];
  if (!provider.recipientSelector) return emails;

  document.querySelectorAll(provider.recipientSelector).forEach(el => {
    const email = el.textContent?.trim() || el.value?.trim() || el.getAttribute('data-email');
    if (email?.includes('@')) emails.push(email);
  });

  // Fallback: look for a plain text input labelled "To"
  if (!emails.length) {
    document.querySelectorAll('input[placeholder*="To"], input[name="to"]').forEach(input => {
      input.value.split(/[,;]/).forEach(e => {
        const trimmed = e.trim();
        if (trimmed.includes('@')) emails.push(trimmed);
      });
    });
  }

  return [...new Set(emails)];
}

function getWebmailSender(provider) {
  if (!provider.senderSelector) return null;
  const el = document.querySelector(provider.senderSelector);
  if (!el) return null;
  if (el.tagName === 'SELECT') return el.value;
  return el.value || el.textContent || null;
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

function makeWebmailButton(label, cls) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `pqcmail-wm-btn ${cls}`;
  btn.textContent = label;
  return btn;
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `pqcmail-toast pqcmail-toast--${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('pqcmail-toast--visible'));
  setTimeout(() => { t.classList.remove('pqcmail-toast--visible'); setTimeout(() => t.remove(), 300); }, 3000);
}

function escapeHtml(s = '') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

function scan() {
  const provider = detectProvider();
  if (!provider) return;

  document.querySelectorAll(provider.composeSelector).forEach(el => injectIntoCompose(el, provider));
  document.querySelectorAll(provider.readSelector).forEach(el => injectDecryptBanner(el));
}

new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
scan();
setInterval(scan, 1200);

console.log('[PQCMail] Webmail injector active');
