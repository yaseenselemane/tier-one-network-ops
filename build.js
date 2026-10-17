// Makes ./dist with only what the game needs online (no server, tests or notes).
// Upload that folder (or dist.zip) to any static host, e.g. Cloudflare Pages.
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const entry of ['index.html', 'css', 'js']) fs.cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });

// Cloudflare Pages reads this file: short cache so updates reach players quickly, plus basic hardening.
fs.writeFileSync(path.join(dist, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '/js/*',
  '  Cache-Control: public, max-age=300',
  '/css/*',
  '  Cache-Control: public, max-age=300',
  '',
].join('\n'));

const count = d => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
console.log(`dist ready: ${count(dist)} files in ${dist}`);
