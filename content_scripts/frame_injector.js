/**
 * PQCMail – Frame Injector
 * Injects sandboxed iframes (compose_frame + read_frame) into webmail,
 * exactly like Mailvelope does with OpenPGP.
 *
 * The iframes are isolated from the host page's JavaScript,
 * preventing the host page from reading plaintext.
 *
 * Communication model:
 *   Host page  →  content_script  →  background SW  →  crypto worker
 *                     ↕ postMessage
 *               Sandboxed iframe
 */

'use strict';

const COMPOSE_FRAME_URL = browser.runtime.getURL('popup/compose_frame.html');
const READ_FRAME_URL    = browser.runtime.getURL('popup/read_frame.html');
const ARMORED_HEADER    = '-----BEGIN PQCMAIL MESSAGE-----';

// ─── Compose Frame ────────────────────────────────────────────────────────────

/**
 * Replace a webmail compose textarea with a sandboxed PQCMail iframe.
 * On completion, the iframe posts back the armored ciphertext and
 * this function inserts it into the original textarea.
 */
function openComposeFrame(originalTextarea) {
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.className = 'pqcmail-frame-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    width: min(640px, 95vw);
    height: min(480px, 85vh);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6);
  `;

  const iframe = document.createElement('iframe');
  iframe.src = COMPOSE_FRAME_URL;
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  // Allow access to browser.runtime via 'allow-same-origin'
  iframe.sandbox = 'allow-scripts allow-same-origin';

  wrapper.appendChild(iframe);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);

  // Listen for messages from the iframe
  function onMessage(event) {
    if (event.source !== iframe.contentWindow) return;

    if (event.data?.type === 'pqcmail:compose_done') {
      const armored = event.data.armored;
      // Insert into original textarea / contentEditable
      if (originalTextarea.tagName === 'TEXTAREA' || originalTextarea.tagName === 'INPUT') {
        originalTextarea.value = armored;
        originalTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        originalTextarea.innerText = armored;
      }
      cleanup();
    }

    if (event.data?.type === 'pqcmail:compose_cancel') {
      cleanup();
    }
  }

  function cleanup() {
    window.removeEventListener('message', onMessage);
    overlay.remove();
  }

  window.addEventListener('message', onMessage);

  // Close on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) cleanup();
  });
}

// ─── Read Frame ───────────────────────────────────────────────────────────────

/**
 * Replace an element containing an armored PQCMail block with a
 * sandboxed read frame that decrypts and displays the content.
 */
function openReadFrame(container, recipientEmail) {
  const armored = container.innerText?.trim() || container.textContent?.trim();
  if (!armored.includes(ARMORED_HEADER)) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    width: 100%;
    min-height: 200px;
    border-radius: 8px;
    overflow: hidden;
  `;

  const iframe = document.createElement('iframe');
  iframe.src = READ_FRAME_URL;
  iframe.style.cssText = 'width:100%;height:320px;border:none;';
  iframe.sandbox = 'allow-scripts allow-same-origin';

  wrapper.appendChild(iframe);

  // Wait for the frame to signal it's ready, then send the data
  function onMessage(event) {
    if (event.source !== iframe.contentWindow) return;

    if (event.data?.type === 'pqcmail:read_frame_ready') {
      iframe.contentWindow.postMessage({
        type: 'pqcmail:decrypt',
        armored,
        recipientEmail,
      }, browser.runtime.getURL('/'));
      window.removeEventListener('message', onMessage);
    }
  }

  window.addEventListener('message', onMessage);
  container.replaceWith(wrapper);
}

// ─── Export for use in other content scripts ──────────────────────────────────

window.__pqcmail = window.__pqcmail || {};
window.__pqcmail.openComposeFrame = openComposeFrame;
window.__pqcmail.openReadFrame    = openReadFrame;
