/**
 * يدمج واجهة الجوال من GitHub (HEAD) مع النسخة المحلية (سطح المكتب).
 * الجوال: من commit HEAD — سطح المكتب: من index.html الحالي.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localPath = path.join(root, 'index.html');
const backupPath = path.join(root, 'index.local-desktop-backup.html');

const MOBILE_HTML_PATTERNS = [
  /<div[^>]*id="sidebarOverlay"[^>]*>[\s\S]*?<\/div>/,
  /<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/,
  /<div[^>]*id="wfMobTicketsHead"[\s\S]*?<\/div>\s*(?=<div id="ticketList")/,
  /<div[^>]*id="rpMobTicketsHead"[\s\S]*?<\/div>\s*(?=<div id="reportList")/,
];

const MOBILE_JS_FUNCS = [
  'layoutMobileBottomNav',
  'mountMobileBottomNav',
  'syncMobileBottomNavLayout',
  'setNativeAppShellActive',
  'syncMobTicketsColWidths',
  'syncMobTicketsScroll',
  'mobTicketsScrollRoot',
];

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

function extractMobileCssFromGithub(githubCss) {
  const MOBILE_SEL = /html:not\(\.mr-desktop-ui\)|\.mobile-bottom-nav|\.mob-nav-item|#mobileBottomNav|#wfMobTicketsHead|#rpMobTicketsHead|wf-tickets-table--mob|wf-mob-tickets|\.wf-mob-|--mr-mob-bottom-nav|mirsad-app-active|\.hamburger-btn|sidebar-overlay|\.td-mob-sheet|mr-mob-view-h/i;

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

  const chunks = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(githubCss)) !== null) {
    const part = stripNonMobile(m[1]);
    if (part.length > 80) chunks.push(part);
  }
  return chunks.join('\n\n');
}

function injectAfterAppShellOpen(local, snippet, label) {
  if (local.includes(snippet.slice(0, 60))) return local;
  const anchor = '<div class="app-shell">';
  const idx = local.indexOf(anchor);
  if (idx === -1) throw new Error(`anchor not found for ${label}`);
  const insertAt = idx + anchor.length;
  return local.slice(0, insertAt) + `\n    <!-- ${label} (GitHub mobile) -->\n` + snippet + '\n' + local.slice(insertAt);
}

function injectMobileCss(local, mobileCss) {
  if (!mobileCss.trim()) return local;
  const marker = '/* ═══ MOBILE UI (GitHub HEAD) ═══ */';
  if (local.includes(marker)) return local;
  const block = `\n    ${marker}\n${mobileCss}\n`;
  const anchor = '</style>';
  const first = local.indexOf(anchor);
  if (first === -1) throw new Error('first </style> not found');
  return local.slice(0, first) + block + local.slice(first);
}

function injectMobileJs(local, github, names) {
  let out = local;
  const marker = '/* ═══ MOBILE JS (GitHub HEAD) ═══ */';
  const injections = [];
  for (const name of names) {
    if (new RegExp(`function ${name}\\s*\\(`).test(out)) continue;
    const fn = extractFunction(github, name);
    if (fn) injections.push(fn);
  }
  if (!injections.length) return out;
  const block = `\n      ${marker}\n      ${injections.join('\n\n      ')}\n`;
  const anchor = '// ═══════════════════════════════════════════════════════════════════════════\n      // 12. MASTER RENDER';
  const idx = out.indexOf(anchor);
  if (idx === -1) throw new Error('MASTER RENDER anchor not found');
  return out.slice(0, idx) + block + out.slice(idx);
}

function fixDeviceDetection(html) {
  html = html.replace(
    /<html lang="ar" dir="rtl" data-theme="light" class="mr-desktop-ui">/,
    '<html lang="ar" dir="rtl" data-theme="light">'
  );

  const stub = `function isNativeMobileShell() { return false; }

      function isDesktopUi() { return true; }

      function syncDesktopUiClass() {
        document.documentElement.classList.add('mr-desktop-ui');
      }

      function isMobileViewport() { return false; }`;

  const replacement = `function isNativeMobileShell() {
        return !!(window.matchMedia('(display-mode: standalone)').matches
          || window.navigator.standalone
          || document.referrer.includes('android-app://'));
      }

      function isMobileViewport() {
        return typeof window !== 'undefined' && window.matchMedia('(max-width: 992px)').matches;
      }

      function isDesktopUi() {
        return !isMobileViewport();
      }

      function syncDesktopUiClass() {
        const desktop = isDesktopUi();
        document.documentElement.classList.toggle('mr-desktop-ui', desktop);
        document.documentElement.classList.toggle('mr-mobile-ui', !desktop);
      }`;

  if (html.includes(stub)) {
    html = html.replace(stub, replacement);
  }

  return html;
}

function wireDesktopStylesheets(html) {
  const desktopLinkRe = /<link rel="stylesheet" href="styles\/(desktop|shared)\/[^"]+"[^>]*>/g;
  return html.replace(desktopLinkRe, (tag) => {
    if (tag.includes('media=')) return tag;
    return tag.replace(/\/?>$/, ' media="screen and (min-width: 993px)">');
  });
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

  const newApply = `syncDesktopUiClass();
          if (isDesktopUi()) {
            if (typeof layoutMobileBottomNav === 'function') {
              const nav = document.getElementById('mobileBottomNav');
              if (nav) nav.style.display = 'none';
            }
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

  if (!html.includes('syncDesktopUiClass();') || !html.includes('function initMobileViewportSync')) {
    // ensure boot calls syncDesktopUiClass early
    html = html.replace(
      /function initMobileViewportSync\(\) \{\s*const mq = window\.matchMedia/,
      `function initMobileViewportSync() {
        syncDesktopUiClass();
        const mq = window.matchMedia`
    );
  }

  return html;
}

function main() {
  const local = readFileSync(localPath, 'utf8');
  writeFileSync(backupPath, local, 'utf8');
  console.log('Backup:', backupPath);

  const github = execSync('git show HEAD:index.html', { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

  let merged = local;

  for (const pat of MOBILE_HTML_PATTERNS) {
    const m = github.match(pat);
    if (!m) continue;
    const label = m[0].slice(0, 40).replace(/\s+/g, ' ');
    if (m[0].includes('sidebarOverlay') && merged.includes('id="sidebarOverlay"')) continue;
    if (m[0].includes('mobileBottomNav') && merged.includes('id="mobileBottomNav"')) continue;
    if (m[0].includes('wfMobTicketsHead') && merged.includes('id="wfMobTicketsHead"')) continue;
    if (m[0].includes('rpMobTicketsHead') && merged.includes('id="rpMobTicketsHead"')) continue;
    merged = injectAfterAppShellOpen(merged, m[0], label);
    console.log('Injected HTML:', label);
  }

  const mobileCss = extractMobileCssFromGithub(github);
  console.log('Mobile CSS chars:', mobileCss.length);
  merged = injectMobileCss(merged, mobileCss);

  merged = injectMobileJs(merged, github, MOBILE_JS_FUNCS);
  merged = fixDeviceDetection(merged);
  merged = wireDesktopStylesheets(merged);
  merged = patchInitMobileViewportSync(merged);

  // تشغيل مبكر لتجنب وميض الواجهة
  if (!merged.includes('syncDesktopUiClassEarly')) {
    merged = merged.replace(
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
      `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script id="syncDesktopUiClassEarly">(function(){var d=window.matchMedia('(max-width:992px)').matches;document.documentElement.classList.toggle('mr-desktop-ui',!d);document.documentElement.classList.toggle('mr-mobile-ui',d);})();</script>`
    );
  }

  writeFileSync(localPath, merged, 'utf8');
  console.log('Merged index.html written.');
}

main();
