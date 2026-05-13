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
  'mk-iconbtn--ghost': '.btn.btn-ghost',
  'mk-iconbtn--xs': '.btn.btn-ghost.btn-sm',
  'mk-iconbtn__dot': '.notif-bell-count',
  'mk-user': '.mr-topbar-user',
  'mk-user__av': '.mr-topbar-user-av',
  'mk-user__info': '.mr-topbar-user-info',
  'mk-user__hello': '.mr-topbar-hello',
  'mk-user__name': '.mr-topbar-name',
  'mk-only-mobile': '.hamburger-btn',
  'mk-sidebar': '.sidebar',
  'mk-sb-close': '.sidebar-close',
  'mk-sb-overlay': '.sidebar-overlay',
  'mk-sb-nav': '.sidebar-nav',
  'mk-sb-section': '.nav-section-label',
  'mk-nav-item': '.nav-item',
  'mk-nav-item__label': '.nav-item-label',
  'mk-nav-badge': '.nav-badge',
  'mk-sb-user': '.sidebar-user',
  'mk-logout': '.logout-btn',
  'mk-card': ['.panel', '.md-card', '.modal-card', '.wf-panel'],
  'mk-card-hd': ['.panel-header', '.md-card-hd', '.wf-panel-intro'],
  'mk-card-hd--stack': '.wf-panel-intro',
  'mk-card-hd__ico': '.md-card-hd-iconwrap',
  'mk-card-hd__ico--purple': '.md-card-hd-iconwrap.md-ico-purple',
  'mk-card-hd__ico--blue': '.md-card-hd-iconwrap.md-ico-blue',
  'mk-card-hd__text': '.md-card-hd-text',
  'mk-link-all': '.md-link-all',
  'mk-card-bd': ['.panel-body', '.md-card-bd', '.modal-body'],
  'mk-card--flex': '.md-card',
  'mk-btn': '.btn',
  'mk-btn--sm': '.btn.btn-sm',
  'mk-btn--primary': ['.btn.btn-primary', '.lp-btn-primary', '.confirm-ok'],
  'mk-btn--success': '.btn.btn-success',
  'mk-btn--danger': ['.btn.btn-danger', '.confirm-ok.danger'],
  'mk-btn--warning': '.btn.btn-warning',
  'mk-btn--ghost': ['.btn.btn-ghost', '.btn.btn-secondary', '.confirm-cancel'],
  'mk-badge': '.badge',
  'mk-badge--blue': '.badge.b-blue',
  'mk-badge--green': '.badge.b-green',
  'mk-badge--amber': '.badge.b-amber',
  'mk-badge--red': '.badge.b-red',
  'mk-badge--purple': '.badge.b-purple',
  'mk-badge--gray': '.badge.b-gray',
  'mk-search': ['.figma-search-wrap', '.wf-search'],
  'mk-search--wide': '.figma-search-wrap.wf-search',
  'mk-search__btn': '.figma-search-btn',
  'mk-dash': '.md-dash',
  'mk-hero': '.md-hero',
  'mk-hero__title': '.md-hero-title',
  'mk-hero__sub': '.md-hero-sub',
  'mk-hero__wave': '.md-wave',
  'mk-stats-grid': '.md-stats-grid',
  'mk-stat-card': '.md-stat-card',
  'mk-stat-card__copy': '.md-stat-copy',
  'mk-stat-card__label': '.md-stat-label',
  'mk-stat-card__value': '.md-stat-value',
  'mk-stat-card__foot': '.md-stat-foot',
  'mk-stat-card__foot--muted': '.md-foot-muted',
  'mk-stat-card__foot--up': '.md-foot-up',
  'mk-stat-card__foot--down': '.md-foot-down',
  'mk-stat-card__ico': '.md-stat-ico',
  'mk-stat-card__ico--blue': '.md-stat-ico.md-ico-blue',
  'mk-stat-card__ico--green': '.md-stat-ico.md-ico-green',
  'mk-stat-card__ico--amber': '.md-stat-ico.md-ico-amber',
  'mk-stat-card__ico--red': '.md-stat-ico.md-ico-red',
  'mk-split': '.md-split',
  'mk-recent': '.md-recent-item',
  'mk-recent__icon': '.md-recent-icon',
  'mk-recent__icon--info': '.md-recent-icon.md-ico-info',
  'mk-recent__icon--success': '.md-recent-icon.md-ico-success',
  'mk-recent__icon--warn': '.md-recent-icon.md-ico-warn',
  'mk-recent__body': '.md-recent-body',
  'mk-recent__title': '.md-recent-title',
  'mk-recent__desc': '.md-recent-desc',
  'mk-recent__time': '.md-recent-time',
  'mk-quick-grid': '.md-quick-grid',
  'mk-quick': '.md-quick-btn',
  'mk-state-row': '.md-state-row',
  'mk-state-row__head': '.md-state-head',
  'mk-state-row__label': '.md-state-label',
  'mk-state-row__count': '.md-state-count',
  'mk-state-row__bar': '.md-state-bar',
  'mk-state-row__fill': '.md-state-fill',
  'mk-fill--amber': '.md-fill-amber',
  'mk-fill--blue': '.md-fill-blue',
  'mk-fill--purple': '.md-fill-purple',
  'mk-fill--red': '.md-fill-red',
  'mk-fill--green': '.md-fill-green',
  'mk-wf-panel': '.wf-panel',
  'mk-wf-hd': '.wf-panel-intro',
  'mk-wf-title': '.wf-panel-title',
  'mk-wf-sub': '.wf-panel-sub',
  'mk-wf-toolbar': '.wf-toolbar',
  'mk-wf-filters': '.wf-filters',
  'mk-chip': '.wf-chip',
  'mk-wf-table-wrap': '.wf-table-wrap',
  'mk-table': '.data-table',
  'mk-emp': '.wf-emp',
  'mk-emp__name': '.wf-emp-name',
  'mk-emp__num': '.wf-emp-num',
  'mk-empty': '.table-empty',
  'mk-modal-overlay': ['.modal', '.confirm-overlay'],
  'mk-modal': ['.modal-card', '.confirm-box'],
  'mk-modal__hd': ['.modal-header', '.confirm-title'],
  'mk-modal__bd': ['.modal-body', '.confirm-msg'],
  'mk-modal__ft': ['.modal-footer', '.confirm-actions'],
  'mk-kv': '.detail-kv',
  'mk-kv__row': '.detail-kv-row',
  'mk-kv__k': '.detail-kv-k',
  'mk-kv__v': '.detail-kv-v',
  'mk-section-title': '.section-title',
  'mk-stepper': '.wf-steps',
  'mk-step': '.wf-step',
  'mk-step__dot': '.wf-step-circle',
  'mk-step__lbl': '.wf-step-label',
  'mk-field': '.form-group',
  'mk-field__lbl': '.form-label',
  'mk-field__hint': '.form-hint',
  'mk-field__hint--err': '.form-hint.err',
  'mk-input': ['.form-input', '.form-select', '.form-textarea', '.lp-input', '.figma-search-input', '.mr-topbar-search-input'],
  'mk-input--ta': '.form-textarea',
  'mk-input-wrap': '.lp-input-wrap',
  'mk-seg': '.seg-control',
  'mk-seg__opt': '.seg-option',
  'mk-drop': '.upload-drop',
  'mk-drop__txt': '.upload-drop-text',
  'mk-section-hd': '.rp-toolbar',
  'mk-section-hd__title': '.rp-toolbar h3',
  'mk-section-hd__sub': '.rp-toolbar p',
  'mk-cmp-grid': ['.cmp-kpis', '.cmp-podium-row'],
  'mk-cmp-card__hd': '.cmp-kpi-head',
  'mk-cmp-card__title': '.cmp-kpi-title',
  'mk-cmp-card__city': '.cmp-kpi-city',
  'mk-cmp-card__bd': '.cmp-kpi-body',
  'mk-cmp-card__stats': '.cmp-kpi-stats',
  'mk-cmp-card__stat': '.cmp-kpi-stat',
  'mk-cmp-card__stat-lbl': '.cmp-kpi-stat-label',
  'mk-cmp-card__stat-val': '.cmp-kpi-stat-value',
  'mk-form-panel': '#tab-newTicket .panel',
  'mk-form-hd': '#tab-newTicket .panel-header',
  'mk-form-grid': '.form-grid',
  'mk-form-ft': '.modal-footer',
  'mk-req': '.required-mark',
  'mk-field--full': '.form-group.form-group--full',
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
  'mk-num': ['.num-latin', '[data-numeric]'],
};

const stateMap = {
  'is-active': 'active',
  'is-open': 'open',
  'is-done': 'done',
};

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function aliasesForToken(token) {
  if (!token.startsWith('.')) return [token];

  const match = token.match(/^(\.[A-Za-z0-9_-]+)(.*)$/);
  if (!match) return [token];

  const className = match[1];
  let rest = match[2] || '';
  const key = className.slice(1);

  if (!key.startsWith('mk-')) return [token];

  for (const [from, to] of Object.entries(stateMap)) {
    rest = rest.replace(new RegExp(`\\.${from}(?=$|[^a-zA-Z0-9_-])`), `.${to}`);
  }

  const mapped = aliasMap[key];
  if (!mapped) return null;
  const list = Array.isArray(mapped) ? mapped : [mapped];
  return list.map((alias) => `${alias}${rest}`);
}

function transformSelector(selector) {
  const chunks = selector.split(',').map((part) => part.trim());
  const out = [];

  for (const chunk of chunks) {
    const tokens = chunk.split(/\s+/).filter(Boolean);
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

function findBlockEnd(css, openBraceIndex) {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return i;
}

function emitRules(css, write) {
  let i = 0;

  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i += 1;
    if (i >= css.length) break;

    if (css.startsWith('@keyframes', i) || css.startsWith('@font-face', i)) {
      const brace = css.indexOf('{', i);
      i = findBlockEnd(css, brace);
      continue;
    }

    if (css.startsWith('@media', i)) {
      const brace = css.indexOf('{', i);
      if (brace === -1) break;
      const header = css.slice(i, brace).trim();
      const inner = css.slice(brace + 1, findBlockEnd(css, brace) - 1);
      const nested = [];
      emitRules(inner, (rule) => nested.push(rule));
      if (nested.length) write(`${header} {\n${nested.join('\n')}\n}\n`);
      i = findBlockEnd(css, brace);
      continue;
    }

    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const selector = css.slice(i, brace).trim();
    const body = css.slice(brace + 1, findBlockEnd(css, brace) - 1);
    i = findBlockEnd(css, brace);

    if (!selector.includes('.mk-')) continue;
    const mapped = transformSelector(selector);
    for (const sel of mapped) {
      write(`${sel} {${body}}\n`);
      if (/^#loginScreen/.test(sel) || sel.includes('#loginScreen ')) continue;
      if (/(\.(md-|wf-|nav-|sidebar|topbar|lp-|panel|mr-topbar|brand-|modal|confirm|badge|btn|data-table|figma-search|rp-|cmp-|form-)|^main\.main|^\.content\b|#tab-newTicket)/.test(sel)) {
        write(`#appWrap ${sel} {${body}}\n`);
      }
    }
  }
}

const css = stripComments(fs.readFileSync(stylesPath, 'utf8'));
const chunks = [];
emitRules(css, (rule) => chunks.push(rule));

let output = '/* Mirsad platform bridge — production class aliases */\n';
output += '@import url("ui_kits/mirsad/styles.css");\n\n';
output += chunks.join('\n');
output += '\n.brand-area .brand-icon i, #loginScreen .lp-brand-ico i, #loginTransition .lt-shield i { display: none; }\n';
output += '#loginScreen .lp-title i.fa-wand-magic-sparkles { color: var(--mr-primary); }\n';
output += '.mr-topbar-search-input { flex: 1; border: 0; outline: none; background: transparent; font-family: var(--font); font-size: 13px; color: var(--mr-text); }\n';
output += '.mr-topbar-search-input::placeholder { color: var(--mr-text-muted); }\n';
output += '.figma-search-input { flex: 1; border: 0; outline: none; background: transparent; font-family: var(--font); font-size: 13px; color: var(--mr-text); }\n';
output += '.figma-search-input::placeholder { color: var(--mr-text-muted); }\n';

fs.writeFileSync(outPath, output, 'utf8');
console.log('Wrote', outPath, 'rules', chunks.length);
