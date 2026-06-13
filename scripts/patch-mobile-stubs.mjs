/**
 * يستبدل دوال الجوال الفارغة بنسخ GitHub ويربط renderTicketList بالجهاز.
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const githubPath = path.join(root, '.merge-github-index.html');

function extractBlock(src, startPattern, endAnchor) {
  const start = src.search(startPattern);
  if (start === -1) return null;
  const end = src.indexOf(endAnchor, start);
  if (end === -1) return null;
  return src.slice(start, end);
}

function extractFunction(src, name) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

function replaceStub(html, name, body) {
  const stubRe = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{\\s*\\}`, 'g');
  if (!stubRe.test(html)) {
    console.warn('stub not found:', name);
    return html;
  }
  return html.replace(stubRe, body);
}

function replaceFunction(html, name, body) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(html);
  if (!m) {
    console.warn('function not found:', name);
    return html;
  }
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return html.slice(0, m.index) + body + html.slice(i);
}

let html = readFileSync(indexPath, 'utf8');
const github = readFileSync(githubPath, 'utf8');

const fnNames = [
  'setNativeAppShellActive',
  'initNativeAppFeel',
  'layoutMobileBottomNav',
  'mountMobileBottomNav',
  'syncMobBottomNavHeight',
  'syncMobileBottomNavLayout',
  'syncMobileBottomNav',
  'bindMobTicketsHeadScroll',
  'mobileNavGo',
];

for (const name of fnNames) {
  const fn = extractFunction(github, name);
  if (!fn) {
    console.warn('missing in github:', name);
    continue;
  }
  if (new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{\\s*\\}`).test(html)) {
    html = replaceStub(html, name, fn);
    console.log('patched stub:', name);
  } else if (new RegExp(`function ${name}\\s*\\(`).test(html)) {
    html = replaceFunction(html, name, fn);
    console.log('replaced fn:', name);
  } else {
    console.warn('not in local:', name);
  }
}

// MR_MOB_NAV_SPREAD_MAX
if (!html.includes('MR_MOB_NAV_SPREAD_MAX')) {
  const constBlock = extractFunction(github, 'layoutMobileBottomNav');
  const m = constBlock && constBlock.match(/const MR_MOB_NAV_SPREAD_MAX = \d+;/);
  if (m) {
    html = html.replace(
      /function layoutMobileBottomNav\(\)/,
      `${m[0]}\n\n      function layoutMobileBottomNav()`
    );
    console.log('added MR_MOB_NAV_SPREAD_MAX');
  }
}

// portalFilterPanelsForMob — نسخة الجوال من GitHub
const portalMob = extractFunction(github, 'portalFilterPanelsForMob');
if (portalMob) {
  html = replaceFunction(html, 'portalFilterPanelsForMob', portalMob);
  console.log('patched portalFilterPanelsForMob');
}

// renderTicketListMobile من GitHub
let mobileRender = extractFunction(github, 'renderTicketList');
if (mobileRender) {
  mobileRender = mobileRender.replace(/^function renderTicketList/, 'function renderTicketListMobile');
  if (!html.includes('function renderTicketListMobile')) {
    const anchor = '      function renderTicketList(tickets, opts) {';
    const idx = html.indexOf(anchor);
    if (idx === -1) throw new Error('renderTicketList anchor missing');
    html = html.slice(0, idx) + mobileRender + '\n\n' + html.slice(idx);
    console.log('inserted renderTicketListMobile');
  }
}

// غلاف renderTicketList — جوال vs سطح مكتب
const wrapper = `      function renderTicketList(tickets, opts) {
        if (!isDesktopUi()) return renderTicketListMobile(tickets, opts);
        return renderTicketListDesktop(tickets, opts);
      }

      function renderTicketListDesktop(tickets, opts) {`;

if (!html.includes('renderTicketListDesktop')) {
  html = html.replace(
    /      function renderTicketList\(tickets, opts\) \{/,
    wrapper
  );
  console.log('wrapped renderTicketList');
}

// usesMobileSidebarDrawer
html = html.replace(
  /function usesMobileSidebarDrawer\(\) \{\s*return false;\s*\}/,
  `function usesMobileSidebarDrawer() {
        return isMobileViewport();
      }`
);

writeFileSync(indexPath, html, 'utf8');
console.log('patch-mobile-stubs done');
