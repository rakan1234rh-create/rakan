/**
 * Home-screen PNGs: full-bleed from icons/wefaq-homescreen-fullbleed.svg (no double frame).
 * Run: npm install sharp && node scripts/export-wefaq-homescreen-png.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'icons');
const svgPath = join(iconsDir, 'wefaq-homescreen-fullbleed.svg');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install sharp: npm install sharp');
  process.exit(1);
}

const svg = readFileSync(svgPath);
const density = 384;

async function exportSize(size, name) {
  const buf = await sharp(svg, { density })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(iconsDir, name), buf);
  console.log('Wrote', join(iconsDir, name));
}

await exportSize(512, 'homescreen-512.png');
await exportSize(512, 'homescreen-maskable-512.png');
await exportSize(192, 'homescreen-192.png');
await exportSize(180, 'apple-touch-icon.png');

writeFileSync(join(iconsDir, 'wefaq-512.png'), readFileSync(join(iconsDir, 'homescreen-512.png')));
writeFileSync(join(iconsDir, 'wefaq-192.png'), readFileSync(join(iconsDir, 'homescreen-192.png')));
