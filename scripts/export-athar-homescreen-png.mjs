/**
 * ATHAR PWA icons — شعار Brandmark الهندسي على خلفية داكنة (بدون خطوط).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'icons');
const fontsDir = join(iconsDir, 'fonts');
const BLEED_BG = '#000000';
const VIEW = 842;
const ICON_CACHE_VER = '407';

mkdirSync(fontsDir, { recursive: true });

const logoPaths = readFileSync(join(iconsDir, 'athar-app-icon.svg'), 'utf8')
  .replace(/<\?xml[^>]*>\s*/i, '')
  .replace(/<!--[\s\S]*?-->\s*/g, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

let Resvg;
let sharp;
try {
  ({ Resvg } = await import('@resvg/resvg-js'));
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install deps: npm install sharp @resvg/resvg-js');
  process.exit(1);
}

function splitLogoInner(inner) {
  const defsMatch = inner.match(/<defs>[\s\S]*?<\/defs>/i);
  const defs = defsMatch ? defsMatch[0] : '';
  const bgRects = [...inner.matchAll(/<rect[^>]*\/>/g)].map((m) => m[0]).join('\n  ');
  const wordmark = inner
    .replace(/<defs>[\s\S]*?<\/defs>\s*/i, '')
    .replace(/<rect[^>]*\/>/g, '')
    .trim();
  return { defs, bgRects, wordmark };
}

function buildSvg(contentScale) {
  const s = contentScale;
  const { defs, bgRects, wordmark } = splitLogoInner(logoPaths);
  const body = s === 1
    ? `${defs}\n  ${bgRects}\n  ${wordmark}`
    : `${defs}\n  ${bgRects}\n  <g transform="translate(${(VIEW / 2) * (1 - s)} ${(VIEW / 2) * (1 - s)}) scale(${s})">${wordmark}</g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">
  ${body}
</svg>`;
}

const svgAny = buildSvg(1);
// Maskable: keep safe-zone padding but still larger than before
const svgMask = buildSvg(0.90);

writeFileSync(join(iconsDir, 'athar-homescreen-fullbleed.svg'), svgAny);
writeFileSync(join(iconsDir, 'athar-homescreen-maskable.svg'), svgMask);

async function exportPng(svg, size, name) {
  const renderPx = size * 4;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: renderPx },
    font: {
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  const buf = await sharp(rendered.asPng())
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
