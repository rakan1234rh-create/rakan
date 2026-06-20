/**
 * ATHAR PWA icons — نفس شعار الدخول مع خطوط ZCOOL XiaoWei + Petrona (resvg).
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
const ICON_CACHE_VER = '393';

const FONT_SOURCES = [
  {
    file: 'ZCOOLXiaoWei-Regular.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf',
  },
  {
    file: 'Petrona-wght.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/petrona/Petrona%5Bwght%5D.ttf',
  },
];

mkdirSync(fontsDir, { recursive: true });

async function ensureFonts() {
  for (const { file, url } of FONT_SOURCES) {
    const dest = join(fontsDir, file);
    if (existsSync(dest)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Font download failed: ${url} (${res.status})`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('Downloaded', file);
  }
}

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
const svgMask = buildSvg(0.92);

writeFileSync(join(iconsDir, 'athar-homescreen-fullbleed.svg'), svgAny);
writeFileSync(join(iconsDir, 'athar-homescreen-maskable.svg'), svgMask);

const fontFiles = FONT_SOURCES.map(({ file }) => join(fontsDir, file));

async function exportPng(svg, size, name) {
  const renderPx = size * 4;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: renderPx },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: 'ZCOOL XiaoWei',
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

await ensureFonts();

const v = ICON_CACHE_VER;
await exportPng(svgAny, 512, `athar-pwa-512-v${v}.png`);
await exportPng(svgAny, 192, `athar-pwa-192-v${v}.png`);
await exportPng(svgAny, 180, `athar-pwa-180-v${v}.png`);
await exportPng(svgMask, 512, `athar-pwa-maskable-512-v${v}.png`);

const WORDMARK_VER = '388';
const wordmarkSvg = readFileSync(join(iconsDir, 'athar-wordmark-email.svg'), 'utf8');
const wordmarkW = 840;
const wordmarkH = Math.round(wordmarkW * (555 / 903));
const wordmarkResvg = new Resvg(wordmarkSvg, {
  fitTo: { mode: 'width', value: wordmarkW },
  background: 'transparent',
  font: {
    fontFiles,
    loadSystemFonts: false,
    defaultFontFamily: 'ZCOOL XiaoWei',
  },
});
const wordmarkBuf = await sharp(wordmarkResvg.render().asPng())
  .resize(wordmarkW, wordmarkH, { kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(join(iconsDir, `athar-wordmark-email-v${WORDMARK_VER}.png`), wordmarkBuf);
console.log('Wrote', `athar-wordmark-email-v${WORDMARK_VER}.png`, `${wordmarkW}x${wordmarkH}`);

writeFileSync(join(iconsDir, 'icon-cache-ver.txt'), ICON_CACHE_VER + '\n');
console.log('Done v' + ICON_CACHE_VER);
