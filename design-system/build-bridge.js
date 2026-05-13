const fs = require('fs');
const path = require('path');

const stylesPath = path.join(__dirname, 'ui_kits', 'mirsad', 'styles.css');
const outPath = path.join(__dirname, 'platform-bridge.css');

const aliasMap = {
  'mk-app': ['#appWrap.app', '.app-shell'],
  'mk-app__body': '.app-body',
  'mk-app__main': 'main.main',
  'mk-app__main-inner': '.content',
  'mk-topbar': ['header.topbar.unified-banner', '.topbar.unified-banner'],
  'mk-brand': '.brand-area',
  'mk-brand__icon': '.brand-icon',
  'mk-brand__mono': '.brand-mono',
  'mk-brand__text': '.brand-text',
  'mk-topbar__tools': '.topbar-tools',
  'mk-topbar__search': '.mr-topbar-search',
  'mk-clock': '.topbar-clock',
  'mk-iconbtn': '.topbar-btn',
  'mk-iconbtn__dot': '.notif-bell-count',
  'mk-user': '.mr-topbar-user',
  'mk-user__av': '.mr-topbar-user-av',
  'mk-user__info': '.mr-topbar-user-info',
  'mk-user__hello': '.mr-topbar-hello',
  'mk-user__name': '.mr-topbar-name',
  'mk-sidebar': '.sidebar',
  'mk-sb-nav': '.sidebar-nav',
  'mk-sb-section': '.nav-section-label',
  'mk-sb-item': '.nav-item',
  'mk-sb-item__label': '.nav-item-label',
  'mk-sb-item__badge': '.nav-badge',
  'mk-sb-foot': '.sidebar-user',
  'mk-sb-logout': '.logout-btn',
  'mk-sb-overlay': '.sidebar-overlay',
  'mk-sb-close': '.sidebar-close-btn',
  'mk-card': ['.panel', '.md-card', '.modal-card', '.wf-panel'],
  'mk-card__hd': ['.panel-header', '.wf-panel-intro', '.md-card-hd'],
  'mk-card__bd': ['.panel-body', '.wf-panel-body', '.md-card-bd'],
  'mk-btn': '.btn',
  'mk-btn--primary': ['.btn.btn-primary', '.lp-btn-primary'],
  'mk-btn--ghost': ['.btn.btn-ghost', '.btn.btn-secondary'],
  'mk-badge': '.badge',
  'mk-badge--blue': '.badge.b-blue',
  'mk-badge--green': '.badge.b-green',
  'mk-badge--amber': '.badge.b-amber',
  'mk-badge--red': '.badge.b-red',
  'mk-badge--purple': '.badge.b-purple',
  'mk-badge--gray': '.badge.b-gray',
  'mk-search': '.figma-search-wrap',
  'mk-search__btn': '.figma-search-btn',
  'mk-table-wrap': ['.wf-table-wrap', '.data-table-wrap'],
  'mk-table': '.data-table',
  'mk-wf-panel': '.wf-panel',
  'mk-wf-toolbar': '.wf-toolbar',
  'mk-wf-search': '.wf-search',
  'mk-wf-status': '.wf-status-select',
  'mk-wf-count': '.wf-count',
  'mk-wf-process': '.wf-process-btn',
  'mk-kpi': '.md-stat-card',
  'mk-kpi__ico': '.md-stat-ico',
  'mk-login': '#loginScreen.lp-screen',
  'mk-login__blobs': '.lp-bg-blobs',
  'mk-login__blob': '.lp-blob',
  'mk-login__blob--a': '.lp-blob-a',
  'mk-login__blob--b': '.lp-blob-b',
  'mk-login__center': '.lp-center',
  'mk-login__card': '.lp-card',
  'mk-login__hd': '.lp-hd',
  'mk-login__ico': '.lp-brand-ico',
  'mk-login__title': '.lp-title',
  'mk-login__sub': '.lp-sub',
  'mk-login__bd': '.lp-bd',
  'mk-login__row': '.lp-row',
  'mk-login__lbl': '.lp-label',
  'mk-login__input': '.lp-input',
  'mk-login__input-wrap': '.lp-input-wrap',
  'mk-field': '.form-group',
  'mk-field__lbl': '.form-label',
  'mk-input': ['.form-input', '.form-select', '.form-textarea'],
  'mk-modal': '.modal-overlay',
  'mk-modal__card': '.modal-card',
  'mk-modal__hd': '.modal-header',
  'mk-modal__bd': '.modal-body',
  'mk-modal__ft': '.modal-footer',
};

const stateMap = {
  'is-active': 'active',
  'is-open': 'open',
};

function aliasesForToken(token) {
  const match = token.match(/^(\.[A-Za-z0-9_-]+)(.*)$/);
  if (!match) return null;
  let className = match[1];
  const rest = match[2] || '';

  let stateSuffix = '';
  for (const [from, to] of Object.entries(stateMap)) {
    if (className.endsWith(`.${from}`)) {
      className = className.slice(0, -(from.length + 1));
      stateSuffix = `.${to}`;
      break;
    }
  }

  const key = className.slice(1);
  const mapped = aliasMap[key];
  if (!mapped) return null;
  const list = Array.isArray(mapped) ? mapped : [mapped];
  return list.map((alias) => `${alias}${stateSuffix}${rest}`);
}

function transformSelector(selector) {
  const chunks = selector.split(',').map((part) => part.trim());
  const out = [];

  for (const chunk of chunks) {
    const tokens = chunk.split(/\s+/);
    const tokenAliases = tokens.map((token) => aliasesForToken(token));

    if (tokenAliases.some((entry) => entry === null)) continue;

    const combos = tokenAliases.reduce(
      (acc, entry) => acc.flatMap((prefix) => entry.map((value) => (prefix ? `${prefix} ${value}` : value))),
      ['']
    );

    combos.forEach((combo) => out.push(combo.trim()));
  }

  return out;
}

const css = fs.readFileSync(stylesPath, 'utf8');
let manual = '/* Mirsad platform bridge — production class aliases */\n@import url("ui_kits/mirsad/styles.css");\n\n';

for (let start = 0; start < css.length; ) {
  const nextDot = css.indexOf('.', start);
  const nextAt = css.indexOf('@', start);
  let ruleStart = -1;
  if (nextDot === -1) ruleStart = nextAt;
  else if (nextAt === -1) ruleStart = nextDot;
  else ruleStart = Math.min(nextDot, nextAt);

  if (ruleStart === -1) break;
  const brace = css.indexOf('{', ruleStart);
  if (brace === -1) break;
  const selector = css.slice(ruleStart, brace).trim();
  let depth = 1;
  let end = brace + 1;
  while (end < css.length && depth > 0) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
    end += 1;
  }
  const body = css.slice(brace + 1, end - 1);
  start = end;

  if (!selector.includes('.mk-')) continue;
  const mapped = transformSelector(selector);
  if (!mapped.length) continue;
  for (const sel of mapped) manual += `${sel} {${body}}\n`;
}

manual += '\n.brand-area .brand-icon i { display: none; }\n';
manual += '#loginScreen .lp-title i.fa-wand-magic-sparkles { color: var(--mr-primary); }\n';

fs.writeFileSync(outPath, manual, 'utf8');
console.log('Wrote', outPath);
