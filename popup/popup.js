'use strict';
const msg = (type, data={}) => browser.runtime.sendMessage({ type, data });
const $ = id => document.getElementById(id);
let identities = [], activePanel = null;

function showPanel(id) {
  if (activePanel) $(activePanel).classList.remove('active');
  $(id).classList.add('active');
  activePanel = id;
}
function hidePanel(id) { $(id).classList.remove('active'); if(activePanel===id) activePanel=null; }

function setLoading(text='Working…') { $('loading-text').textContent=text; $('loading').classList.add('visible'); }
function stopLoading() { $('loading').classList.remove('visible'); }

async function refreshStatus() {
  const s = await msg('pqcmail:get_status');
  $('version-badge').textContent = `v${s.version||'0.1'}`;
  $('worker-dot').className = 'status-dot ' + (s.workerReady  ? 'ok' : 'err');
  $('server-dot').className = 'status-dot ' + (s.serverOnline ? 'ok' : 'warn');
}

async function loadIdentities() {
  const r = await msg('pqcmail:get_identities');
  identities = r.identities || [];
  const sel = $('identity-select');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— No identity —</option>';
  identities.forEach(id => {
    const o = document.createElement('option');
    o.value = id.email;
    o.textContent = `${id.email} [${id.algo}]`;
    sel.appendChild(o);
  });
  if (cur && identities.find(i=>i.email===cur)) sel.value = cur;
  else if (identities.length) sel.value = identities[0].email;
  updateFingerprint();
}

function updateFingerprint() {
  const id = identities.find(i=>i.email===$('identity-select').value);
  const row = $('fingerprint-row');
  if (id?.fingerprint) { $('fingerprint-val').textContent=id.fingerprint; row.style.display='flex'; }
  else row.style.display='none';
}

// Encrypt
$('enc-submit').addEventListener('click', async () => {
  const recipient = $('enc-recipient').value.trim();
  const plaintext = $('enc-message').value.trim();
  const sender    = $('identity-select').value || null;
  if (!recipient) { alert('Enter a recipient'); return; }
  if (!plaintext) { alert('Enter a message'); return; }
  setLoading('Encrypting…');
  const r = await msg('pqcmail:encrypt_request', { plaintext, recipientEmails:[recipient], senderEmail:sender });
  stopLoading();
  if (r.success) { $('enc-result').value=r.armored; $('enc-output').classList.add('visible'); }
  else alert(`Failed: ${r.error}`);
});

$('enc-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('enc-result').value).then(() => {
    $('enc-copy').textContent='✓ Copied!';
    setTimeout(()=>{ $('enc-copy').textContent='📋 Copy'; }, 1500);
  });
});

// Decrypt
$('dec-submit').addEventListener('click', async () => {
  const armored = $('dec-input').value.trim();
  const email   = $('identity-select').value;
  if (!armored) { alert('Paste a PQCMail block'); return; }
  if (!email)   { alert('Select an identity'); return; }
  setLoading('Decrypting…');
  const r = await msg('pqcmail:decrypt_request', { armored, recipientEmail:email });
  stopLoading();
  if (r.success) {
    $('dec-sig-status').innerHTML = r.verified
      ? `<span class="sig-ok">✓ Verified — ${esc(r.sender)}</span>`
      : `<span class="sig-warn">⚠ Signature not verified</span>`;
    $('dec-result').textContent = r.plaintext;
    $('dec-output').classList.add('visible');
  } else alert(`Failed: ${r.error}`);
});

// Key generation
$('kg-submit').addEventListener('click', async () => {
  const email    = $('kg-email').value.trim();
  const kemAlgo  = $('kg-kem').value;
  const sigAlgo  = $('kg-sig').value;
  const publish  = $('kg-publish').checked;
  if (!email) { alert('Enter your email'); return; }
  setLoading('Generating PQC keys…');
  const r = await msg('pqcmail:keygen_request', { email, kemAlgo, sigAlgo });
  if (r.success && publish) { setLoading('Publishing to PQCServer…'); await msg('pqcmail:publish_key', { email }); }
  stopLoading();
  if (r.success) {
    $('kg-result').innerHTML = `<strong>✓ Done!</strong> Fingerprint:<br/><code style="font-size:10px;color:#38bdf8">${esc(r.fingerprint)}</code>${publish?' — published':''}`;
    $('kg-result').classList.add('visible');
    await loadIdentities();
  } else alert(`Failed: ${r.error}`);
});

// Lookup
$('lu-submit').addEventListener('click', async () => {
  const email = $('lu-email').value.trim();
  if (!email) { alert('Enter an email'); return; }
  setLoading('Searching…');
  const r = await msg('pqcmail:lookup_key', { email });
  stopLoading();
  const el = $('lu-result');
  el.classList.add('visible');
  el.innerHTML = r.key
    ? `<strong style="color:#10b981">✓ Found</strong> (${r.source})<br/>Algo: ${esc(r.key.algo)}<br/><code style="font-size:10px;color:#38bdf8">${esc(r.key.fingerprint||'')}</code>`
    : `<span style="color:#f59e0b">⚠ No key for ${esc(email)}</span>`;
});

document.querySelectorAll('.close-btn').forEach(b =>
  b.addEventListener('click', () => hidePanel(b.dataset.close))
);

$('encrypt-btn').addEventListener('click', () => showPanel('encrypt-panel'));
$('decrypt-btn').addEventListener('click', () => showPanel('decrypt-panel'));
$('sign-btn').addEventListener('click',    () => showPanel('encrypt-panel'));
$('lookup-btn').addEventListener('click',  () => showPanel('lookup-panel'));
$('new-identity-btn').addEventListener('click', () => showPanel('keygen-panel'));
$('identity-select').addEventListener('change', updateFingerprint);
$('options-btn').addEventListener('click', () => { browser.runtime.openOptionsPage(); window.close(); });
$('pqcserver-btn').addEventListener('click', () => { browser.tabs.create({url:'https://pqcserver.com'}); window.close(); });

function esc(s='') { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

(async () => { await loadIdentities(); await refreshStatus(); })();
