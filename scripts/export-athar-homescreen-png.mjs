/**
 * ATHAR PWA icons — ملفات بأسماء جديدة + نسخة جذر لـ iOS (apple-touch-icon.png).
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'icons');
const BLEED_BG = '#121212';
const VIEW = 842;
const ICON_CACHE_VER = '374';

const logoPaths = readFileSync(join(iconsDir, 'athar-app-icon.svg'), 'utf8')
  .replace(/<\?xml[^>]*>\s*/i, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install sharp: npm install sharp');
  process.exit(1);
}

function buildSvg(contentScale) {
  const s = contentScale;
  const tx = (VIEW / 2) * (1 - s);
  const ty = (VIEW / 2) * (1 - s);
  const logoOnly = logoPaths.replace(/<rect[^>]*\/>/, '').trim();
  const body = s === 1
    ? logoPaths
    : `<rect width="${VIEW}" height="${VIEW}" fill="${BLEED_BG}"/>
  <g transform="translate(${tx} ${ty}) scale(${s})">${logoOnly}</g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">
  ${body}
</svg>`;
}

const svgAny = buildSvg(1);
const svgMask = buildSvg(0.92);

writeFileSync(join(iconsDir, 'athar-homescreen-fullbleed.svg'), svgAny);
writeFileSync(join(iconsDir, 'athar-homescreen-maskable.svg'), svgMask);

async function exportPng(svg, size, name) {
  const renderPx = size * 4;
  const density = (renderPx / VIEW) * 72;
  const buf = await sharp(Buffer.from(svg), { density })
    .resize(renderPx, renderPx, { fit: 'fill' })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .flatten({ background: BLEED_BG })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(iconsDir, name), buf);
  console.log('Wrote', name, size + 'x' + size);
}

const v = ICON_CACHE_VER;
await exportPng(svgAny, 512, `athar-pwa-512-v${v}.png`);
await exportPng(svgAny, 192, `athar-pwa-192-v${v}.png`);
await exportPng(svgAny, 180, `athar-pwa-180-v${v}.png`);
await exportPng(svgMask, 512, `athar-pwa-maskable-512-v${v}.png`);
writeFileSync(join(iconsDir, 'icon-cache-ver.txt'), ICON_CACHE_VER + '\n');
console.log('Done v' + ICON_CACHE_VER);
