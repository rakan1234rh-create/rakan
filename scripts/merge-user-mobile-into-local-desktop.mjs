/**
 * يدمج نسخة الجوال (index.user-mobile-source.html) مع سطح المكتب المحلي
 * (index.local-desktop-backup.html) دون تعديل أي من الملفين المصدرين.
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopPath = path.join(root, 'index.local-desktop-backup.html');
const mobilePath = path.join(root, 'index.user-mobile-source.html');
const outPath = path.join(root, 'index.html');

function injectBeforeAnchor(html, anchor, snippet, label) {
  if (!snippet.trim() || html.includes(snippet.slice(0, Math.min(60, snippet.length)).trim())) return html;
  const idx = html.indexOf(anchor);
  if (idx === -1) throw new Error(`anchor not found for ${label}`);
  return html.slice(0, idx) + `\n    <!-- ${label} (user mobile) -->\n${snippet}\n` + html.slice(idx);
}

function injectMobileHtml(html, mobile) {
  const overlay = mobile.match(/<div[^>]*class="sidebar-overlay"[^>]*id="sidebarOverlay"[^>]*>[\s\S]*?<\/div>/)?.[0];
  if (overlay && !html.includes('id="sidebarOverlay"')) {
    html = injectBeforeAnchor(html, '<div class="app-shell">', overlay, 'sidebarOverlay');
    console.log('HTML: sidebarOverlay');
  }

  const wfHead = '<div id="wfMobTicketsHead" class="wf-mob-tickets-head" aria-hidden="true"></div>';
  if (!html.includes('id="wfMobTicketsHead"')) {
    html = injectBeforeAnchor(html, '<div id="ticketList"', wfHead, 'wfMobTicketsHead');
    console.log('HTML: wfMobTicketsHead');
  }

  const rpHead = '<div id="rpMobTicketsHead" aria-hidden="true"></div>';
  if (!html.includes('id="rpMobTicketsHead"')) {
    html = injectBeforeAnchor(html, '<div id="reportList"', rpHead, 'rpMobTicketsHead');
    console.log('HTML: rpMobTicketsHead');
  }

  const nav = mobile.match(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/)?.[0];
  if (nav && !html.includes('id="mobileBottomNav"')) {
    html = injectBeforeAnchor(html, '\n    <!-- MODALS -->', nav, 'mobileBottomNav');
    console.log('HTML: mobileBottomNav');
  }

  return html;
}

const MOBILE_JS_REPLACE = [
  'isNativeMobileShell',
  'isDesktopUi',
  'syncDesktopUiClass',
  'isMobileViewport',
  'setNativeAppShellActive',
  'initNativeAppFeel',
  'layoutMobileBottomNav',
  'mountMobileBottomNav',
  'syncMobileBottomNavLayout',
  'syncMobBottomNavHeight',
  'syncMobileBottomNav',
  'mobileNavGo',
];

const EARLY_LOCK_CSS = `
  <style id="mr-ui-shell-early-lock">
    @media (max-width: 992px) {
      html.mr-mobile-ui #appWrap #sidebar,
      html.mr-mobile-ui #appWrap .app-body .sidebar {
        display: none !important;
        visibility: hidden !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        flex: 0 0 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
        position: absolute !important;
        opacity: 0 !important
      }

      html.mr-mobile-ui #sidebarToggleBtn,
      html.mr-mobile-ui .sidebar-drawer-toggle.sidebar-toggle-btn,
      html.mr-mobile-ui #sidebarOverlay {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important
      }

      html.mr-mobile-ui #mobileBottomNav.mobile-bottom-nav {
        display: flex !important
      }

      html.mr-mobile-ui .wf-desk-tickets-host .wf-tickets-table:not(.wf-tickets-table--mob):not(.wf-tickets-table--mob-head):not(.wf-tickets-table--mob-body) {
        display: none !important
      }
    }

    @media (min-width: 993px) {
      html.mr-desktop-ui #mobileBottomNav.mobile-bottom-nav {
        display: none !important
      }

      html.mr-desktop-ui #sidebarToggleBtn.sidebar-drawer-toggle {
        display: none !important
      }
    }
  </style>`;

const MOBILE_SEL = /html:not\(\.mr-desktop-ui\)|html\.mr-mobile-ui|\.mobile-bottom-nav|\.mob-nav-item|#mobileBottomNav|#wfMobTicketsHead|#rpMobTicketsHead|wf-tickets-table--mob|wf-mob-tickets|\.wf-mob-|--mr-mob-bottom-nav|mirsad-app-active|\.hamburger-btn|sidebar-overlay|\.td-mob-sheet|mr-mob-view-h/i;

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

function isMobileSelector(sel) {
  return MOBILE_SEL.test(sel);
}

function stripNonMobile(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      out += css.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    const brace = css.indexOf('{', i);
    if (brace === -1) {
      out += css.slice(i);
      break;
    }
    const selector = css.slice(i, brace);
    let depth = 1;
    let j = brace + 1;
    while (j < css.length && depth) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const block = css.slice(i, j);
    const header = selector.trim();
    if (header.startsWith('@media') && /max-width\s*:/i.test(header)) {
      out += block;
    } else if (header.startsWith('@')) {
      if (isMobileSelector(selector)) out += block;
    } else if (isMobileSelector(selector)) {
      out += block;
    }
    i = j;
  }
  return out.trim();
}

function extractMobileCss(mobileHtml) {
  const chunks = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(mobileHtml)) !== null) {
    const part = stripNonMobile(m[1]);
    if (part.length > 80) chunks.push(part);
  }
  return chunks.join('\n\n');
}

function injectMobileCss(html, mobileCss) {
  if (!mobileCss.trim()) return html;
  const marker = '/* ═══ MOBILE UI (user source) ═══ */';
  if (html.includes(marker)) return html;
  const block = `\n    ${marker}\n${mobileCss}\n`;
  const anchor = '</style>';
  const first = html.indexOf(anchor);
  if (first === -1) throw new Error('first </style> not found');
  return html.slice(0, first) + block + html.slice(first);
}

function replaceFunction(html, name, replacement) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(html);
  if (!m) {
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
  return html.slice(0, m.index) + replacement + html.slice(i);
}

function injectMissingFunctions(html, mobile, names) {
  const marker = '/* ═══ MOBILE JS (user source) ═══ */';
  const injections = [];
  for (const name of names) {
    if (new RegExp(`function ${name}\\s*\\(`).test(html)) continue;
    const fn = extractFunction(mobile, name);
    if (fn) injections.push(fn);
  }
  if (!injections.length) return html;
  const block = `\n      ${marker}\n      ${injections.join('\n\n      ')}\n`;
  const anchor = '// ═══════════════════════════════════════════════════════════════════════════\n      // 12. MASTER RENDER';
  const idx = html.indexOf(anchor);
  if (idx === -1) throw new Error('MASTER RENDER anchor not found');
  return html.slice(0, idx) + block + html.slice(idx);
}

function patchSidebarInit(html, mobile) {
  const desktopFn = extractFunction(html, 'initSidebarMobileControls');
  const mobileFn = extractFunction(mobile, 'initSidebarMobileControls');
  if (!desktopFn || !mobileFn) throw new Error('initSidebarMobileControls missing');

  let patchedDesktop = desktopFn
    .replace('function initSidebarMobileControls()', 'function _initSidebarMobileControlsDesktop()')
    .replace('if (sb) syncDesktopSidebarRailSize(sb);', 'if (sb && isDesktopUi()) syncDesktopSidebarRailSize(sb);');

  const router = `
      function initSidebarMobileControls() {
        syncDesktopUiClass();
        if (isDesktopUi()) _initSidebarMobileControlsDesktop();
        else _initSidebarMobileControlsMobile();
      }`;

  html = replaceFunction(html, 'initSidebarMobileControls', patchedDesktop);
  const anchor = '// كشف الدوال للـ window';
  const idx = html.indexOf(anchor);
  if (idx === -1) throw new Error('window export anchor not found');
  return html.slice(0, idx) + `\n      ${mobileFn.replace('function initSidebarMobileControls()', 'function _initSidebarMobileControlsMobile()')}\n\n${router}\n\n      ` + html.slice(idx);
}

function patchDesktopSidebarRailGuard(html) {
  const fn = extractFunction(html, 'initDesktopSidebarRail');
  if (!fn || fn.includes('if (!isDesktopUi()) return')) return html;
  const patched = fn.replace(
    /function initDesktopSidebarRail\(\) \{\s*/,
    'function initDesktopSidebarRail() {\n        if (!isDesktopUi()) return;\n        '
  );
  return replaceFunction(html, 'initDesktopSidebarRail', patched);
}

function patchDeviceDetection(html) {
  const stubBlock = `function isNativeMobileShell() { return false; }

      function isDesktopUi() { return true; }

      function syncDesktopUiClass() {
        document.documentElement.classList.add('mr-desktop-ui');
      }

      function isMobileViewport() { return false; }`;

  const detection = `function isNativeMobileShell() {
        return !!(window.matchMedia('(display-mode: standalone)').matches
          || window.navigator.standalone
          || document.referrer.includes('android-app://'));
      }

      function isDesktopUi() {
        return !isMobileViewport();
      }

      function syncDesktopUiClass() {
        document.documentElement.classList.add('mr-desktop-ui');
      }

      function isMobileViewport() { return false; }`;

  if (html.includes(stubBlock)) {
    return html.replace(stubBlock, detection);
  }

  html = replaceFunction(html, 'isNativeMobileShell', `function isNativeMobileShell() {
        return !!(window.matchMedia('(display-mode: standalone)').matches
          || window.navigator.standalone
          || document.referrer.includes('android-app://'));
      }`);

  html = replaceFunction(html, 'isDesktopUi', `function isDesktopUi() {
        return !isMobileViewport();
      }`);

  return html;
}

function patchSyncDesktopUiClass(html) {
  const replacement = `function syncDesktopUiClass() {
        const desktop = isDesktopUi();
        document.documentElement.classList.toggle('mr-desktop-ui', desktop);
        document.documentElement.classList.toggle('mr-mobile-ui', !desktop);
        if (!desktop) {
          const sb = document.getElementById('sidebar');
          if (sb) {
            sb.classList.remove('open', 'sidebar-rail-open', 'sidebar-rail-hover', 'sidebar-rail-expanded');
            delete sb.dataset.railExpanded;
            delete sb.dataset.railHover;
            sb.style.removeProperty('width');
            sb.style.removeProperty('min-width');
            sb.style.removeProperty('flex');
            sb.style.removeProperty('max-width');
          }
          document.getElementById('sidebarOverlay')?.classList.remove('open');
          const mobNav = document.getElementById('mobileBottomNav');
          if (mobNav) mobNav.style.removeProperty('display');
        }
      }`;
  return replaceFunction(html, 'syncDesktopUiClass', replacement);
}

function wireDesktopStylesheets(html) {
  const desktopLinkRe = /<link rel="stylesheet" href="styles\/(desktop|shared)\/[^"]+"[^>]*>/g;
  return html.replace(desktopLinkRe, (tag) => {
    if (tag.includes('media=')) return tag;
    return tag.replace(/\/?>$/, ' media="screen and (min-width: 993px)">');
  });
}

function injectMobileHeadMeta(html, mobile) {
  html = html.replace(
    /<html lang="ar" dir="rtl" data-theme="light" class="mr-desktop-ui">/,
    '<html lang="ar" dir="rtl" data-theme="light">'
  );

  const viewport = mobile.match(/<meta name="viewport"[^>]*>/);
  if (viewport) {
    html = html.replace(/<meta name="viewport"[^>]*>/, viewport[0]);
  }

  const mobMetas = [
    'mobile-web-app-capable',
    'apple-mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style',
    'apple-mobile-web-app-title',
  ];
  for (const name of mobMetas) {
    const m = mobile.match(new RegExp(`<meta name="${name}"[^>]*>`));
    if (!m || html.includes(m[0])) continue;
    html = html.replace(/<meta name="theme-color"[^>]*>/, (line) => `${line}\n  ${m[0]}`);
  }

  if (!html.includes('syncDesktopUiClassEarly')) {
    html = html.replace(
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
      `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script id="syncDesktopUiClassEarly">(function(){var d=window.matchMedia('(max-width:992px)').matches;document.documentElement.classList.toggle('mr-desktop-ui',!d);document.documentElement.classList.toggle('mr-mobile-ui',d);})();</script>`
    );
  }

  if (!html.includes('mr-ui-shell-early-lock')) {
    html = html.replace('<style>', `${EARLY_LOCK_CSS}\n  <style>`);
  }

  return html;
}

function patchInitMobileViewportSync(html) {
  const oldApply = `if (isDesktopUi()) {
            if (document.getElementById('tab-workflow')?.classList.contains('active') && typeof filterTickets === 'function') {
              filterTickets();
            }
            if (document.getElementById('tab-reports')?.classList.contains('active') && typeof filterReports === 'function') {
              filterReports();
            }
            return;
          }`;

  const newApply = `if (isDesktopUi()) {
            const nav = document.getElementById('mobileBottomNav');
            if (nav) nav.style.display = 'none';
            if (document.getElementById('tab-workflow')?.classList.contains('active') && typeof filterTickets === 'function') {
              filterTickets();
            }
            if (document.getElementById('tab-reports')?.classList.contains('active') && typeof filterReports === 'function') {
              filterReports();
            }
            if (typeof scheduleDeskColSyncForActiveTab === 'function') scheduleDeskColSyncForActiveTab(true);
            return;
          }
          if (typeof mountMobileBottomNav === 'function') mountMobileBottomNav();
          if (typeof layoutMobileBottomNav === 'function') layoutMobileBottomNav();`;

  if (html.includes(oldApply)) {
    html = html.replace(oldApply, newApply);
  }
  return html;
}

function main() {
  const desktop = readFileSync(desktopPath, 'utf8');
  const mobile = readFileSync(mobilePath, 'utf8');
  let merged = desktop;

  merged = injectMobileHtml(merged, mobile);

  const mobileCss = extractMobileCss(mobile);
  console.log('Mobile CSS chars:', mobileCss.length);
  merged = injectMobileCss(merged, mobileCss);

  for (const name of MOBILE_JS_REPLACE) {
    const fn = extractFunction(mobile, name);
    if (!fn) continue;
    merged = replaceFunction(merged, name, fn);
    console.log('JS:', name);
  }

  if (!merged.includes('MR_MOB_NAV_SPREAD_MAX')) {
    const constLine = mobile.match(/const MR_MOB_NAV_SPREAD_MAX = \d+;/)?.[0];
    if (constLine) {
      merged = merged.replace(
        /(\n      function layoutMobileBottomNav\(\) \{)/,
        `\n      ${constLine}\n$1`
      );
      console.log('Const: MR_MOB_NAV_SPREAD_MAX');
    }
  }

  merged = injectMissingFunctions(merged, mobile, MOBILE_JS_REPLACE);
  merged = patchSidebarInit(merged, mobile);
  merged = patchDesktopSidebarRailGuard(merged);
  merged = patchDeviceDetection(merged);
  merged = patchSyncDesktopUiClass(merged);
  merged = injectMobileHeadMeta(merged, mobile);
  merged = wireDesktopStylesheets(merged);
  merged = patchInitMobileViewportSync(merged);

  writeFileSync(outPath, merged, 'utf8');
  console.log('Merged ->', outPath);
  console.log('Sources unchanged:', desktopPath, mobilePath);
}

main();
