# PQCMail — Build Instructions for AMO Reviewers

## Requirements
- Node.js >= 18
- npm >= 9

## Steps to reproduce crypto/pqc_lib.js

```bash
npm install
node build.js
```

This generates `crypto/pqc_lib.js` from `@noble/post-quantum` (MIT license).
All other files are plain JS/HTML/CSS with no build step.

## Verify the bundle
```bash
sha256sum crypto/pqc_lib.js
```
