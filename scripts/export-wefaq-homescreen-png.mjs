/**
 * Home-screen PNGs = same asset as login (wefaq-app-icon / wefaqOfficialLogoHtml).
 * Text → Manrope paths for sharp raster; background #0D0E12 for PWA corners.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'icons');
const fontPath = join(root, 'fonts', 'Manrope-Bold.ttf');
const BLEED_BG = '#0D0E12';
const VIEW = 512;
const SUPER = 8;
const ICON_CACHE_VER = '336';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install sharp: npm install sharp');
  process.exit(1);
}

const font = opentype.parse(readFileSync(fontPath));

function glyphAdvance(ch, fontSize) {
  const g = font.charToGlyph(ch);
  return (g.advanceWidth || 0) * (fontSize / font.unitsPerEm);
}

/** Same metrics as login <text font-size="118" letter-spacing="-6"> */
function wefaqTextPathD(cx, baselineY, fontSize, letterSpacing) {
  const text = 'wefaq';
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    total += glyphAdvance(text[i], fontSize);
    if (i < text.length - 1) total += letterSpacing;
  }
  let x = cx - total / 2;
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    parts.push(font.getPath(ch, x, baselineY, fontSize).toPathData(2));
    x += glyphAdvance(ch, fontSize) + letterSpacing;
  }
  return parts.join(' ');
}

/** Identical to icons/wefaq-app-icon.svg + login wefaqOfficialLogoHtml (paths for export). */
function buildLoginLogoSvg() {
  const textD = wefaqTextPathD(256, 278, 118, -6);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">
  <rect width="${VIEW}" height="${VIEW}" fill="${BLEED_BG}"/>
  <defs>
    <filter id="appShadow" x="44" y="52" width="424" height="432" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="22" stdDeviation="18" flood-color="#000000" flood-opacity="0.22"/>
    </filter>
    <linearGradient id="surface" x1="88" x2="424" y1="70" y2="426" gradientUnits="userSpaceOnUse">
      <stop stop-color="#17181C"/>
      <stop offset="1" stop-color="#0D0E12"/>
    </linearGradient>
  </defs>
  <rect x="66" y="56" width="380" height="380" rx="78" fill="url(#surface)" filter="url(#appShadow)"/>
  <path fill="#F8F8F5" d="${textD}"/>
  <g stroke="#F8F8F5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="132" y1="360" x2="222" y2="360"/>
    <path d="M 290 360 L 400 360 Q 410 360 410 350 L 410 278"/>
    <path d="M222 360 L 244 338 L 254 348"/>
    <path d="M258 352 L 266 360 L 254 372"/>
    <path d="M258 368 L 244 382 L 222 360"/>
    <path d="M246 360 L 268 338 L 290 360 L 268 382 L 246 360 Z"/>
  </g>
</svg>`;
}

const loginSvg = buildLoginLogoSvg();
writeFileSync(join(iconsDir, 'wefaq-homescreen-fullbleed.svg'), loginSvg);
writeFileSync(join(iconsDir, 'wefaq-homescreen-maskable.svg'), loginSvg);

async function exportPng(svg, size, name) {
  const renderPx = size * SUPER;
  const density = (renderPx / VIEW) * 72;
  const buf = await sharp(Buffer.from(svg), { density })
    .resize(renderPx, renderPx, { fit: 'fill' })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .flatten({ background: BLEED_BG })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const meta = await sharp(buf).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${name}: expected ${size}x${size}, got ${meta.width}x${meta.height}`);
  }
  writeFileSync(join(iconsDir, name), buf);
  console.log('Wrote', join(iconsDir, name), `(${meta.width}x${meta.height})`);
}

await exportPng(loginSvg, 1024, 'homescreen-1024.png');
await exportPng(loginSvg, 512, 'homescreen-512.png');
await exportPng(loginSvg, 192, 'homescreen-192.png');
await exportPng(loginSvg, 512, 'homescreen-maskable-512.png');

copyFileSync(join(iconsDir, 'homescreen-512.png'), join(iconsDir, 'apple-touch-icon.png'));
await exportPng(loginSvg, 180, 'apple-touch-icon-180.png');

writeFileSync(join(iconsDir, 'wefaq-512.png'), readFileSync(join(iconsDir, 'homescreen-512.png')));
writeFileSync(join(iconsDir, 'wefaq-192.png'), readFileSync(join(iconsDir, 'homescreen-192.png')));
writeFileSync(join(iconsDir, 'icon-cache-ver.txt'), ICON_CACHE_VER + '\n');
