import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const index = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await fs.readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
const expectedBase = process.env.EXPECT_BASE || '/';

for (const required of ['og:title', 'og:description', 'og:image', 'twitter:card']) {
  if (!index.includes(required)) throw new Error(`Missing metadata: ${required}`);
}
if (!index.includes(`${expectedBase}assets/`)) throw new Error(`Built assets do not use expected base ${expectedBase}`);
if (manifest.name !== 'VratiMe' || manifest.display !== 'standalone') throw new Error('PWA manifest identity is invalid');
if (!await fs.stat(path.join(dist, 'sw.js'))) throw new Error('Service worker is missing');

const expectedIcons = new Map([[192, 'app-logo-192.png'], [512, 'app-logo-512.png']]);
for (const [size, file] of expectedIcons) {
  const icon = manifest.icons.find((item) => item.src === file && item.sizes === `${size}x${size}`);
  if (!icon) throw new Error(`Manifest icon ${size}x${size} is missing`);
  const png = await fs.readFile(path.join(dist, file));
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`PNG dimensions do not match ${size}x${size}`);
}

process.stdout.write(`Static/PWA check passed for base ${expectedBase}.\n`);
