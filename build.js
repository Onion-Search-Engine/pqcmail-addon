/**
 * PQCMail build script — genera crypto/pqc_lib.js
 * Eseguire: node build.js
 */
const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: ['pqc_entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['firefox109'],
  // NO minify — codice leggibile per AMO review
  outfile: path.join(__dirname, 'crypto', 'pqc_lib.js'),
}).then(() => {
  console.log('crypto/pqc_lib.js generato con successo.');
}).catch(e => { console.error(e); process.exit(1); });
