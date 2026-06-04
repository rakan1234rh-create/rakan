/**
 * Export home-screen PNGs from icons/wefaq-app-icon.svg (solid black backdrop).
 * Run: node scripts/export-wefaq-homescreen-png.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'icons');
const svgPath = join(iconsDir, 'wefaq-app-icon.svg');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install sharp: npm install sharp (in project root or scripts/)');
  process.exit(1);
}

const svg = readFileSync(svgPath);
const bg = { r: 0, g: 0, b: 0, alpha: 1 };

async function exportSize(size, name) {
  const buf = await sharp(svg, { density: Math.max(192, Math.round(size * 2)) })
    .resize(size, size, { fit: 'contain', background: bg })
    .flatten({ background: '#000000' })
    .png()
    .toBuffer();
  const out = join(iconsDir, name);
  writeFileSync(out, buf);
  console.log('Wrote', out);
}

await exportSize(512, 'homescreen-512.png');
await exportSize(192, 'homescreen-192.png');
await exportSize(180, 'apple-touch-icon.png');

writeFileSync(join(iconsDir, 'wefaq-512.png'), readFileSync(join(iconsDir, 'homescreen-512.png')));
writeFileSync(join(iconsDir, 'wefaq-192.png'), readFileSync(join(iconsDir, 'homescreen-192.png')));
