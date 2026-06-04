/**
 * Home-screen PNGs: single-layer full-bleed gradient (no inner rounded tile — avoids double frame).
 * purpose=any: logo scaled to fill; maskable: ~90% safe-zone scale on same full-bleed background.
 * Run: npm install sharp && node scripts/export-wefaq-homescreen-png.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'icons');
const BLEED_BG = '#0D0E12';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install sharp: npm install sharp');
  process.exit(1);
}

async function exportPng(svgPath, size, name) {
  const svg = readFileSync(svgPath);
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'fill' })
    .flatten({ background: BLEED_BG })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(buf).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${name}: expected ${size}x${size}, got ${meta.width}x${meta.height}`);
  }
  writeFileSync(join(iconsDir, name), buf);
  console.log('Wrote', join(iconsDir, name), `(${meta.width}x${meta.height})`);
}

await exportPng(
  join(iconsDir, 'wefaq-homescreen-fullbleed.svg'),
  512,
  'homescreen-512.png'
);
await exportPng(
  join(iconsDir, 'wefaq-homescreen-fullbleed.svg'),
  192,
  'homescreen-192.png'
);
await exportPng(
  join(iconsDir, 'wefaq-homescreen-maskable.svg'),
  512,
  'homescreen-maskable-512.png'
);
await exportPng(
  join(iconsDir, 'wefaq-homescreen-fullbleed.svg'),
  180,
  'apple-touch-icon.png'
);

writeFileSync(join(iconsDir, 'wefaq-512.png'), readFileSync(join(iconsDir, 'homescreen-512.png')));
writeFileSync(join(iconsDir, 'wefaq-192.png'), readFileSync(join(iconsDir, 'homescreen-192.png')));
