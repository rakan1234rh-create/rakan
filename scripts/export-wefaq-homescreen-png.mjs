/**
 * Home-screen PNGs — single-layer full-bleed (b73d6da, no inner rounded tile).
 * Gradient fills 512×512; logo scaled 512/380; maskable ~90%; Manrope paths + 4× SS.
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
const SUPER = 4;
const SCALE_ANY = 512 / 380;
const SCALE_MASKABLE = SCALE_ANY * 0.9;
const ICON_CACHE_VER = '337';

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

function buildHomescreenSvg(contentScale) {
  const textD = wefaqTextPathD(256, 278, 118, -6);
  const strokes = `
    <line x1="132" y1="360" x2="222" y2="360"/>
    <path d="M 290 360 L 400 360 Q 410 360 410 350 L 410 278"/>
    <path d="M222 360 L 244 338 L 254 348"/>
    <path d="M258 352 L 266 360 L 254 372"/>
    <path d="M258 368 L 244 382 L 222 360"/>
    <path d="M246 360 L 268 338 L 290 360 L 268 382 L 246 360 Z"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="${VIEW}" y2="${VIEW}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#17181C"/>
      <stop offset="1" stop-color="#0D0E12"/>
    </linearGradient>
  </defs>
  <rect width="${VIEW}" height="${VIEW}" fill="url(#surface)"/>
  <g transform="translate(256 256) scale(${contentScale}) translate(-256 -250)">
    <path fill="#F8F8F5" d="${textD}"/>
    <g stroke="#F8F8F5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      ${strokes}
    </g>
  </g>
</svg>`;
}

const svgAny = buildHomescreenSvg(SCALE_ANY);
const svgMask = buildHomescreenSvg(SCALE_MASKABLE);

writeFileSync(join(iconsDir, 'wefaq-homescreen-fullbleed.svg'), svgAny);
writeFileSync(join(iconsDir, 'wefaq-homescreen-maskable.svg'), svgMask);

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

await exportPng(svgAny, 512, 'homescreen-512.png');
await exportPng(svgAny, 192, 'homescreen-192.png');
await exportPng(svgMask, 512, 'homescreen-maskable-512.png');
copyFileSync(join(iconsDir, 'homescreen-512.png'), join(iconsDir, 'apple-touch-icon.png'));

writeFileSync(join(iconsDir, 'wefaq-512.png'), readFileSync(join(iconsDir, 'homescreen-512.png')));
writeFileSync(join(iconsDir, 'wefaq-192.png'), readFileSync(join(iconsDir, 'homescreen-192.png')));
writeFileSync(join(iconsDir, 'icon-cache-ver.txt'), ICON_CACHE_VER + '\n');
