/**
 * Restore compliance card UI (regions → branches → employees) in index.html
 */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'index.html');
let s = fs.readFileSync(p, 'utf8');

const cssBlock = `
    /* ─── Compliance card board (mk-cmp) ─── */
    #cmpBoard.mk-cmp-board { display: block; }
    .cmp-legacy-dashboard { display: none !important; }
    .mk-cmp-board__head { margin-bottom: 18px; }
    .mk-cmp-board__head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .mk-cmp-board__title { margin: 0; font-size: 20px; font-weight: 800; color: var(--mr-text, var(--text)); }
    .mk-cmp-board__sub { margin: 6px 0 0; font-size: 13px; color: var(--mr-text-3, var(--text3)); }
    .mk-crumbs { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .mk-crumbs button {
      background: var(--mr-surface, var(--surface));
      border: 1px solid var(--mr-border, var(--border));
      color: var(--mr-text-2, var(--text2));
      border-radius: 999px;
      padding: 6px 12px;
      cursor: pointer;
      font-family: var(--font);
      font-size: 12px;
      font-weight: 600;
      transition: all 0.15s;
    }
    .mk-crumbs button:hover:not(:disabled) { border-color: var(--mr-primary-soft); color: var(--mr-primary); }
    .mk-crumbs button.is-active { background: var(--mr-primary, #0f1224); color: #fff; border-color: var(--mr-primary); }
    .mk-crumbs button:disabled { opacity: 0.55; cursor: default; }
    .mk-crumbs i.fa-chevron-left { font-size: 10px; color: var(--mr-text-3); opacity: 0.7; }
    .mk-cmp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    .mk-cmp-grid--emp { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .mk-cmp-card {
      background: var(--mr-surface, var(--surface));
      border: 1px solid var(--mr-border, var(--border));
      border-radius: 20px;
      padding: 18px;
      cursor: pointer;
      transition: border-color 0.18s, box-shadow 0.18s, transform 0.15s;
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .mk-cmp-card:hover {
      border-color: var(--mr-primary-soft, rgba(15, 18, 36, 0.12));
      box-shadow: 0 2px 6px rgba(15, 18, 36, 0.04), 0 8px 24px rgba(15, 18, 36, 0.06);
      transform: translateY(-1px);
    }
    .mk-cmp-card__hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .mk-cmp-card__title { display: flex; gap: 10px; align-items: flex-start; flex: 1; min-width: 0; }
    .mk-cmp-card__title h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--mr-text, var(--text)); }
    .mk-cmp-card__city { font-size: 11px; color: var(--mr-text-3, var(--text3)); display: block; margin-top: 2px; }
    .mk-cmp-card__ico {
      width: 36px; height: 36px; border-radius: 10px;
      background: var(--mr-primary-soft, #eef0f8);
      color: var(--mr-primary, #0f1224);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px;
    }
    .mk-cmp-card__bd { display: flex; align-items: center; gap: 16px; padding-top: 14px; }
    .mk-cmp-card__stats { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .mk-cmp-card__stat { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .mk-cmp-card__stat-lbl { font-size: 11px; color: var(--mr-text-3, var(--text3)); }
    .mk-cmp-card__stat-val { font-size: 14px; font-weight: 700; color: var(--mr-text, var(--text)); font-variant-numeric: tabular-nums; }
    .mk-cmp-donut-sm { position: relative; width: 72px; height: 72px; flex-shrink: 0; text-align: center; }
    .mk-cmp-donut-sm svg { width: 100%; height: 100%; display: block; }
    .mk-cmp-donut-sm__val {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 800; font-family: var(--mono); color: var(--mr-text);
    }
    .mk-cmp-donut-sm__lbl {
      display: block; margin-top: 4px; font-size: 10px; font-weight: 700; color: var(--mr-text-3);
    }
    .mk-cmp-emp-card {
      background: var(--mr-surface, var(--surface));
      border: 1px solid var(--mr-border, var(--border));
      border-radius: 22px;
      padding: 0;
      cursor: pointer;
      overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
      display: flex;
      flex-direction: column;
      text-align: right;
    }
    .mk-cmp-emp-card:hover {
      border-color: var(--mr-primary-soft);
      box-shadow: 0 4px 12px rgba(15, 18, 36, 0.06), 0 16px 40px rgba(15, 18, 36, 0.08);
      transform: translateY(-2px);
    }
    .mk-cmp-emp-card__hd {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px 10px;
      background: linear-gradient(180deg, var(--mr-primary-softer, #f5f6fb) 0%, transparent 100%);
      border-bottom: 1px solid var(--mr-border, var(--border));
    }
    .mk-cmp-emp-card__avatar {
      width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
      background: var(--mr-primary-soft, #eef0f8);
      color: var(--mr-primary);
      border: 1px solid var(--mr-primary-soft);
      display: flex; align-items: center; justify-content: center;
    }
    .mk-cmp-emp-card__avatar i { font-size: 20px; }
    .mk-cmp-emp-card__identity { flex: 1; min-width: 0; }
    .mk-cmp-emp-card__name { margin: 0; font-size: 15px; font-weight: 800; color: var(--mr-text); line-height: 1.35; }
    .mk-cmp-emp-card__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
    .mk-cmp-emp-num { font-family: var(--mono); font-size: 10px; font-weight: 700; color: var(--mr-text-3); }
    .mk-cmp-lvl {
      display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 800; border: 1px solid transparent;
    }
    .mk-cmp-lvl--excellent { background: rgba(22,163,74,.12); color: #15803d; border-color: rgba(22,163,74,.25); }
    .mk-cmp-lvl--good { background: rgba(37,99,235,.1); color: #1d4ed8; border-color: rgba(37,99,235,.22); }
    .mk-cmp-lvl--warn { background: #fef3c7; color: #b45309; border-color: #fde68a; }
    .mk-cmp-lvl--danger { background: rgba(239,68,68,.1); color: #b91c1c; border-color: rgba(239,68,68,.22); }
    .mk-cmp-role { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; }
    .mk-cmp-role--mgr { background: rgba(13,148,136,.14); color: #0f766e; }
    .mk-cmp-role--emp { background: rgba(37,99,235,.12); color: #1d4ed8; }
    .mk-cmp-emp-card__chips {
      display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px 12px;
      min-height: 82px; border-bottom: 1px solid var(--mr-border, var(--border));
    }
    .mk-cmp-emp-chip {
      display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 700; border: 1px solid transparent; white-space: nowrap;
    }
    .mk-cmp-emp-chip--red { background: rgba(239,68,68,.1); color: #b91c1c; border-color: rgba(239,68,68,.2); }
    .mk-cmp-emp-chip--green { background: rgba(22,163,74,.1); color: #15803d; border-color: rgba(22,163,74,.2); }
    .mk-cmp-emp-chip--amber { background: #fef3c7; color: #b45309; border-color: #fde68a; }
    .mk-cmp-emp-chip--blue { background: rgba(37,99,235,.1); color: #1d4ed8; border-color: rgba(37,99,235,.2); }
    .mk-cmp-emp-chip--gray { background: var(--mr-bg, #f4f5f9); color: var(--mr-text-3); border-color: var(--mr-border); }
    .mk-cmp-emp-card__metrics {
      display: flex; flex-direction: row; align-items: stretch; gap: 8px; padding: 12px 16px 10px;
    }
    .mk-cmp-metric-col { flex: 1; min-width: 0; text-align: center; }
    .mk-cmp-metric-col .mk-cmp-donut-sm { margin: 0 auto; }
    .mk-cmp-metric-mini { margin-top: 6px; font-size: 10px; color: var(--mr-text-3); line-height: 1.45; }
    .mk-cmp-metric-mini div { display: flex; justify-content: space-between; gap: 6px; }
    .mk-cmp-emp-card__ft {
      padding: 10px 16px 12px; font-size: 11px; font-weight: 700; color: var(--mr-primary);
      border-top: 1px solid var(--mr-border); display: flex; align-items: center; justify-content: space-between;
    }
    .mk-empty {
      grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--mr-text-3);
      border: 1px dashed var(--mr-border); border-radius: 16px; background: var(--mr-surface);
    }
`;

if (!s.includes('/* ─── Compliance card board (mk-cmp) ─── */')) {
  s = s.replace(
    '.cmp-tab.active {\n      color: var(--blue);\n      border-bottom-color: var(--blue);\n      font-weight: 600\n    }\n',
    '.cmp-tab.active {\n      color: var(--blue);\n      border-bottom-color: var(--blue);\n      font-weight: 600\n    }\n' + cssBlock
  );
}

const htmlOld = `              <div class="cmp-tabs-wrapper">
                <div class="cmp-tabs">
                  <button class="cmp-tab active" onclick="switchCmpTab('regions')" id="cmpt-regions">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>المناطق</span>
                  </button>
                  <button class="cmp-tab" onclick="switchCmpTab('branches')" id="cmpt-branches">
                    <i class="fas fa-store"></i>
                    <span>الفروع</span>
                  </button>
                  <button class="cmp-tab" onclick="switchCmpTab('employees')" id="cmpt-employees">
                    <i class="fas fa-users"></i>
                    <span>الموظفون</span>
                  </button>
                </div>
              </div>
              <div class="cmp-kpis" id="cmpKpis"></div>
              <div class="cmp-dist-card" id="cmpDistCard"></div>
              <div class="cmp-podium-row" id="cmpPodium"></div>
              <div class="cmp-table-card" id="cmpTableCard"></div>`;

const htmlNew = `              <div class="cmp-tabs-wrapper">
                <div class="cmp-tabs">
                  <button class="cmp-tab active" onclick="switchCmpTab('regions')" id="cmpt-regions">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>المناطق</span>
                  </button>
                  <button class="cmp-tab" onclick="switchCmpTab('branches')" id="cmpt-branches">
                    <i class="fas fa-store"></i>
                    <span>الفروع</span>
                  </button>
                  <button class="cmp-tab" onclick="switchCmpTab('employees')" id="cmpt-employees">
                    <i class="fas fa-users"></i>
                    <span>الموظفون</span>
                  </button>
                </div>
              </div>
              <div id="cmpBoard" class="mk-cmp-board" aria-live="polite"></div>
              <div class="cmp-legacy-dashboard" hidden>
              <div class="cmp-kpis" id="cmpKpis"></div>
              <div class="cmp-dist-card" id="cmpDistCard"></div>
              <div class="cmp-podium-row" id="cmpPodium"></div>
              <div class="cmp-table-card" id="cmpTableCard"></div>
              </div>`;

if (s.includes(htmlOld) && !s.includes('id="cmpBoard"')) {
  s = s.replace(htmlOld, htmlNew);
}

const jsBlock = `      state._cmpDrill = state._cmpDrill || { view: 'regions', regionId: '', branchId: '' };

      function cmpScoreLevelMeta(score) {
        const n = Math.round(score);
        if (n >= 90) return { text: 'ممتاز', cls: 'mk-cmp-lvl--excellent' };
        if (n >= 75) return { text: 'جيد', cls: 'mk-cmp-lvl--good' };
        if (n >= 50) return { text: 'تحذير', cls: 'mk-cmp-lvl--warn' };
        return { text: 'متعثر', cls: 'mk-cmp-lvl--danger' };
      }

      function cmpRingColor(score) {
        const n = Math.round(score);
        if (n >= 90) return '#22c55e';
        if (n >= 75) return '#f59e0b';
        return '#ef4444';
      }

      function cmpSmallDonut(value, label, footRows = []) {
        const v = Math.max(0, Math.min(100, Math.round(value)));
        const r = 28;
        const c = (2 * Math.PI * r).toFixed(2);
        const off = (c * (1 - v / 100)).toFixed(2);
        const color = cmpRingColor(v);
        const foot = (footRows || []).map(row =>
          \`<div><span>\${Sec.escapeHTML(row.l)}</span><strong>\${Sec.escapeHTML(String(row.v))}</strong></div>\`
        ).join('');
        return \`<div class="mk-cmp-metric-col">
          <div class="mk-cmp-donut-sm" role="img" aria-label="\${Sec.escapeHTML(label)}: \${v}">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="32" r="\${r}" fill="none" stroke="#e4e6ef" stroke-width="5"/>
              <circle cx="32" cy="32" r="\${r}" fill="none" stroke="\${color}" stroke-width="5"
                stroke-dasharray="\${c}" stroke-dashoffset="\${off}" stroke-linecap="round"
                transform="rotate(-90 32 32)"/>
            </svg>
            <span class="mk-cmp-donut-sm__val">\${v}</span>
          </div>
          <span class="mk-cmp-donut-sm__lbl">\${Sec.escapeHTML(label)}</span>
          \${foot ? \`<div class="mk-cmp-metric-mini">\${foot}</div>\` : ''}
        </div>\`;
      }

      function cmpNeoTrendMeta(viols) {
        const list = viols || [];
        const recent30 = list.filter(v => !violationExcludedFromDeduction(v) && violationAgeDays(v) <= 30).length;
        const prev30 = list.filter(v => {
          if (violationExcludedFromDeduction(v)) return false;
          const a = violationAgeDays(v);
          return a > 30 && a <= 60;
        }).length;
        if (recent30 === 0 && prev30 === 0) {
          return { pct: '0%', cls: 'flat', icon: 'fa-minus', hint: 'مستقر' };
        }
        if (prev30 === 0) {
          return { pct: '+' + recent30, cls: 'down', icon: 'fa-arrow-trend-up', hint: 'زيادة في المخالفات' };
        }
        const delta = ((recent30 - prev30) / prev30) * 100;
        const rounded = Math.abs(delta).toFixed(1);
        if (Math.abs(delta) < 0.05) {
          return { pct: '0%', cls: 'flat', icon: 'fa-minus', hint: 'مستقر' };
        }
        if (delta < 0) {
          return { pct: rounded + '%', cls: 'up', icon: 'fa-arrow-trend-down', hint: 'تحسّن' };
        }
        return { pct: '+' + rounded + '%', cls: 'down', icon: 'fa-arrow-trend-up', hint: 'تراجع' };
      }

      function cmpNeoCardHTML(card, view, opts = {}) {
        const pct = Math.max(0, Math.min(100, Math.round(card.score)));
        const color = cmpRingColor(pct);
        const trendCls = card.trend.cls === 'up' ? 'mk-badge--green' : (card.trend.cls === 'down' ? 'mk-badge--red' : 'mk-badge--gray');
        const clickAttr = card.onClick ? \`onclick="\${card.onClick}"\` : '';
        const r = 28;
        const c = (2 * Math.PI * r).toFixed(2);
        const off = (c * (1 - pct / 100)).toFixed(2);
        const statALabel = view === 'regions' ? 'الفروع' : 'منضبطون';
        const statBLabel = 'الموظفون';
        const entityIcon = opts.icon || card.icon || (view === 'regions' ? 'fa-map-marker-alt' : 'fa-store');
        return \`
          <article class="mk-cmp-card" \${clickAttr} role="button" tabindex="0">
            <div class="mk-cmp-card__hd">
              <div class="mk-cmp-card__title">
                <span class="mk-cmp-card__ico"><i class="fas \${entityIcon}"></i></span>
                <div>
                  <h3>\${Sec.escapeHTML(card.name)}</h3>
                  <span class="mk-cmp-card__city">\${Sec.escapeHTML(card.sub || '—')}</span>
                </div>
              </div>
              <span class="mk-badge \${trendCls}" title="\${Sec.escapeHTML(card.trend.hint || '')}">
                <i class="fas \${card.trend.icon}"></i> \${Sec.escapeHTML(card.trend.pct)}
              </span>
            </div>
            <div class="mk-cmp-card__bd">
              <div class="mk-cmp-card__stats">
                <div class="mk-cmp-card__stat">
                  <span class="mk-cmp-card__stat-lbl">\${Sec.escapeHTML(statALabel)}</span>
                  <span class="mk-cmp-card__stat-val">\${card.branches}</span>
                </div>
                <div class="mk-cmp-card__stat">
                  <span class="mk-cmp-card__stat-lbl">\${Sec.escapeHTML(statBLabel)}</span>
                  <span class="mk-cmp-card__stat-val">\${card.employees}</span>
                </div>
                <div class="mk-cmp-card__stat">
                  <span class="mk-cmp-card__stat-lbl">معدل الامتثال</span>
                  <span class="mk-cmp-card__stat-val" style="color:\${color}">\${pct}%</span>
                </div>
              </div>
              <div class="mk-cmp-donut-sm" aria-hidden="true">
                <svg viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="\${r}" fill="none" stroke="#e4e6ef" stroke-width="5"/>
                  <circle cx="32" cy="32" r="\${r}" fill="none" stroke="\${color}" stroke-width="5"
                    stroke-dasharray="\${c}" stroke-dashoffset="\${off}" stroke-linecap="round"
                    transform="rotate(-90 32 32)"/>
                </svg>
                <span class="mk-cmp-donut-sm__val">\${pct}</span>
              </div>
            </div>
          </article>\`;
      }

      function cmpEmpCardHTML(card) {
        const lvl = cmpScoreLevelMeta(card.score);
        const trendChipCls = card.trend.cls === 'up' ? 'mk-cmp-emp-chip--green' : (card.trend.cls === 'down' ? 'mk-cmp-emp-chip--red' : 'mk-cmp-emp-chip--gray');
        const empId = String(card.id || '').replace(/'/g, "\\\\'");
        const click = card.onClick || \`openCmpItemDetail('employee','\${empId}')\`;
        const roleHtml = card.isManager
          ? '<span class="mk-cmp-role mk-cmp-role--mgr"><i class="fas fa-user-tie"></i> مدير فرع</span>'
          : '<span class="mk-cmp-role mk-cmp-role--emp"><i class="fas fa-user"></i> موظف</span>';
        const chips = [
          \`<span class="mk-cmp-emp-chip \${trendChipCls}"><i class="fas \${card.trend.icon}"></i> اتجاه \${Sec.escapeHTML(card.trend.pct)}</span>\`,
          \`<span class="mk-cmp-emp-chip mk-cmp-emp-chip--red"><i class="fas fa-list"></i> \${card.violCount} مخالفة</span>\`,
          \`<span class="mk-cmp-emp-chip mk-cmp-emp-chip--amber"><i class="fas fa-minus-circle"></i> خصم \${card.deducted}</span>\`
        ];
        if (card.pendingCount > 0) {
          chips.push(\`<span class="mk-cmp-emp-chip mk-cmp-emp-chip--amber"><i class="fas fa-hourglass-half"></i> مراجعة \${card.pendingCount}</span>\`);
        }
        if (card.autoCount > 0) {
          chips.push(\`<span class="mk-cmp-emp-chip mk-cmp-emp-chip--red"><i class="fas fa-forward"></i> تمرير \${card.autoCount}</span>\`);
        }
        if (card.respondedCount > 0) {
          chips.push(\`<span class="mk-cmp-emp-chip mk-cmp-emp-chip--blue"><i class="fas fa-clock"></i> \${card.respondedCount} في الوقت</span>\`);
        }
        return \`
          <article class="mk-cmp-emp-card" onclick="\${click}" role="button" tabindex="0"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();\${click};}">
            <header class="mk-cmp-emp-card__hd">
              <div class="mk-cmp-emp-card__avatar" aria-hidden="true"><i class="fas fa-user"></i></div>
              <div class="mk-cmp-emp-card__identity">
                <h3 class="mk-cmp-emp-card__name">\${Sec.escapeHTML(card.name)}</h3>
                <div class="mk-cmp-emp-card__meta">
                  \${roleHtml}
                  <span class="mk-cmp-emp-num">\${Sec.escapeHTML(card.empNumber || '—')}</span>
                  <span class="mk-cmp-lvl \${lvl.cls}">\${lvl.text}</span>
                </div>
              </div>
            </header>
            <div class="mk-cmp-emp-card__chips">\${chips.join('')}</div>
            <div class="mk-cmp-emp-card__metrics">
              \${cmpSmallDonut(card.score, 'الامتثال', [
                { l: 'الخصم الفعلي', v: card.deducted },
                { l: 'بونص الالتزام', v: '+' + (card.streakBonus || 0) }
              ])}
              \${cmpSmallDonut(card.responseRate != null ? card.responseRate : 100, 'الاستجابة', [
                { l: 'خصم التأخير', v: card.respPenalty || 0 },
                { l: 'بونص الاستجابة', v: '+' + (card.respBonus || 0) }
              ])}
            </div>
            <footer class="mk-cmp-emp-card__ft">
              <span>عرض التفاصيل الكاملة</span>
              <i class="fas fa-chevron-left" aria-hidden="true"></i>
            </footer>
          </article>\`;
      }

      function cmpBackToRegions() {
        state._cmpDrill = { view: 'regions', regionId: '', branchId: '' };
        cmpfState.region = '';
        cmpfState.branch = '';
        state._cmpActiveTab = 'regions';
        renderCompliance();
      }

      function cmpBackToBranches() {
        const d = state._cmpDrill || {};
        state._cmpDrill = { view: 'branches', regionId: d.regionId || '', branchId: '' };
        cmpfState.branch = '';
        state._cmpActiveTab = 'branches';
        renderCompliance();
      }

      function cmpOpenRegionCompliance(regionId) {
        state._cmpDrill = { view: 'branches', regionId, branchId: '' };
        cmpfState.region = regionId;
        cmpfState.branch = '';
        state._cmpActiveTab = 'branches';
        renderCompliance();
      }

      function cmpOpenBranchCompliance(branchId) {
        const b = state.branches.find(x => x.id === branchId);
        state._cmpDrill = { view: 'employees', regionId: b?.region_id || '', branchId };
        cmpfState.region = b?.region_id || '';
        cmpfState.branch = branchId;
        state._cmpActiveTab = 'employees';
        renderCompliance();
      }

      function renderCompliance() {
        const board = document.getElementById('cmpBoard');
        if (!board) return;

        const violations = getViolationsForScoring();
        const role = state.currentUser?.role;
        const isBranchMgr = role === 'branch_manager';
        const bmBranchId = isBranchMgr ? (state.currentUser?.branch_id || '') : '';

        if (!state._cmpDrill) state._cmpDrill = { view: 'regions', regionId: '', branchId: '' };
        let view = state._cmpDrill.view || state._cmpActiveTab || 'regions';

        if (isBranchMgr) {
          const br = bmBranchId && state.branches.find(b => b.id === bmBranchId);
          view = 'employees';
          state._cmpDrill = { view: 'employees', regionId: br?.region_id || '', branchId: bmBranchId };
          cmpfState.region = br?.region_id || '';
          cmpfState.branch = bmBranchId;
        }

        state._cmpActiveTab = view;
        document.querySelectorAll('.cmp-tab').forEach(b => b.classList.remove('active'));
        document.getElementById('cmpt-' + (view === 'regions' ? 'regions' : view === 'branches' ? 'branches' : 'employees'))?.classList.add('active');

        if (view === 'branches' && state._cmpDrill.regionId) cmpfState.region = state._cmpDrill.regionId;
        if (view === 'employees' && state._cmpDrill.branchId) {
          cmpfState.branch = state._cmpDrill.branchId;
          if (state._cmpDrill.regionId) cmpfState.region = state._cmpDrill.regionId;
        }

        let items = buildCmpItems();
        items.sort((a, b) => cmpfState.sort === 'top' ? b.score - a.score : a.score - b.score);

        let heading = 'مؤشرات الامتثال';
        let subheading = 'نظرة عامة على أداء المناطق والفروع والموظفين';
        let breadcrumb = \`
          <button type="button" class="is-active" disabled>المناطق</button>
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
          <button type="button" disabled>الفروع</button>
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
          <button type="button" disabled>الموظفون</button>\`;

        if (view === 'branches') {
          const region = state.regions.find(r => r.id === state._cmpDrill.regionId);
          heading = region ? ('تقييم الفروع · ' + region.name) : 'تقييم الفروع';
          subheading = 'اختر فرعاً لعرض امتثال الموظفين';
          breadcrumb = \`
            <button type="button" onclick="cmpBackToRegions()">المناطق</button>
            <i class="fas fa-chevron-left" aria-hidden="true"></i>
            <button type="button" class="is-active" disabled>الفروع</button>
            <i class="fas fa-chevron-left" aria-hidden="true"></i>
            <button type="button" disabled>الموظفون</button>\`;
        } else if (view === 'employees') {
          const branch = state.branches.find(b => b.id === state._cmpDrill.branchId);
          const region = branch ? state.regions.find(r => r.id === branch.region_id) : null;
          const brLabel = branch ? (branch.name + (branch.city ? ' · ' + branch.city : '')) : '—';
          heading = 'تقييم الموظفين · ' + (branch?.name || '—');
          subheading = 'عرض تفصيلي لمؤشرات امتثال الموظفين داخل الفرع';
          if (region) subheading += ' · ' + region.name;
          breadcrumb = isBranchMgr ? \`
            <button type="button" class="is-active" disabled><i class="fas fa-users"></i> موظفو الفرع</button>\` : \`
            <button type="button" onclick="cmpBackToRegions()">المناطق</button>
            <i class="fas fa-chevron-left" aria-hidden="true"></i>
            <button type="button" onclick="cmpBackToBranches()">الفروع</button>
            <i class="fas fa-chevron-left" aria-hidden="true"></i>
            <button type="button" class="is-active" disabled>الموظفون</button>\`;
        }

        let cardsHTML = '';
        if (!items.length) {
          cardsHTML = '<div class="mk-empty"><i class="fas fa-folder-open" style="font-size:28px;opacity:.4"></i><p>لا توجد بيانات مطابقة للفلاتر</p></div>';
        } else if (view === 'employees') {
          cardsHTML = items.map(item => {
            const stat = item.stat || calcEmpScore(item.id, violations);
            const resp = calcResponseRate(item.id, 'employee');
            const empViols = violations.filter(v => v.employee_id === item.id);
            const branch = state.branches.find(b => b.id === (state.users.find(u => u.id === item.id)?.branch_id));
            const isMgr = branch && state.users.find(u => u.id === item.id && u.role === 'branch_manager');
            return cmpEmpCardHTML({
              id: item.id,
              name: item.name,
              empNumber: item.empNumber || item.extraInfo?.empNumber,
              score: stat.score,
              violCount: stat.violationsCount,
              deducted: stat.deducted,
              pendingCount: stat.pendingCount,
              autoCount: resp.autoCount,
              respondedCount: resp.respondedCount,
              responseRate: resp.score,
              respPenalty: resp.penalty,
              respBonus: resp.bonus,
              streakBonus: stat.streakBonus,
              isManager: !!isMgr,
              trend: cmpNeoTrendMeta(empViols),
              onClick: \`openCmpItemDetail('employee','\${item.id}')\`
            });
          }).join('');
        } else if (view === 'branches') {
          cardsHTML = items.map(item => {
            const stat = item.stat || calcBranchSafety(item.id, violations);
            const brViols = violations.filter(v => v.branch_id === item.id);
            const region = state.regions.find(r => r.id === (state.branches.find(b => b.id === item.id)?.region_id));
            return cmpNeoCardHTML({
              name: item.name,
              sub: region?.name || item.extraInfo?.regionName || '—',
              branches: stat.safeEmps,
              employees: stat.totalEmps,
              score: stat.score,
              trend: cmpNeoTrendMeta(brViols),
              onClick: \`cmpOpenBranchCompliance('\${item.id}')\`
            }, 'branches', { icon: 'fa-store' });
          }).join('');
        } else {
          cardsHTML = items.map(item => {
            const stat = item.stat || calcRegionStability(item.id, violations);
            const regBranches = state.branches.filter(b => b.region_id === item.id);
            const branchIds = regBranches.map(b => b.id);
            const regViols = violations.filter(v => branchIds.includes(v.branch_id));
            return cmpNeoCardHTML({
              name: item.name,
              sub: (stat.branchesCount || 0) + ' فرع',
              branches: stat.branchesCount,
              employees: stat.totalEmps,
              score: stat.score,
              trend: cmpNeoTrendMeta(regViols),
              onClick: \`cmpOpenRegionCompliance('\${item.id}')\`
            }, 'regions', { icon: 'fa-map-marker-alt' });
          }).join('');
        }

        const gridCls = view === 'employees' ? 'mk-cmp-grid mk-cmp-grid--emp' : 'mk-cmp-grid';
        board.innerHTML = \`
          <div class="mk-cmp-board__head">
            <div class="mk-cmp-board__head-row">
              <div>
                <h2 class="mk-cmp-board__title">\${Sec.escapeHTML(heading)}</h2>
                <p class="mk-cmp-board__sub">\${Sec.escapeHTML(subheading)}</p>
              </div>
              <nav class="mk-crumbs" aria-label="مسار الامتثال">\${breadcrumb}</nav>
            </div>
          </div>
          <div class="\${gridCls}">\${cardsHTML}</div>\`;

        updateCmpActiveFiltersTags();
      }

      function renderCompliance_LEGACY_TABLE() {`;

const renderOld = `      function renderCompliance() {
        const tab = state._cmpActiveTab || 'regions';
        let items = buildCmpItems();

        // ترتيب
        items.sort((a, b) => cmpfState.sort === 'top' ? b.score - a.score : a.score - b.score);

        // ─── 1. KPIs ───
        renderCmpKpis(items, tab);

        // ─── 2. Distribution Bar ───
        renderCmpDistribution(items, tab);

        // ─── 3. Top & Bottom Podium ───
        renderCmpPodium(items, tab);

        // ─── 4. Detailed Table (الدفعة 2 لاحقاً، حالياً قائمة بسيطة) ───
        renderCmpDetailedList(items);
      }`;

if (s.includes(renderOld) && !s.includes('function renderCompliance_LEGACY_TABLE')) {
  s = s.replace(renderOld, jsBlock);
}

const switchOld = `      function switchCmpTab(tab) {
        state._cmpActiveTab = tab;
        document.querySelectorAll('.cmp-tab').forEach(b => b.classList.remove('active'));
        document.getElementById(\`cmpt-\${tab}\`)?.classList.add('active');
        // إعادة ضبط فلاتر المنطقة/الفرع عند تغيير التبويب
        cmpfState.region = '';
        cmpfState.branch = '';
        renderCompliance();
      }`;

const switchNew = `      function switchCmpTab(tab) {
        state._cmpActiveTab = tab;
        state._cmpDrill = { view: tab, regionId: '', branchId: '' };
        document.querySelectorAll('.cmp-tab').forEach(b => b.classList.remove('active'));
        document.getElementById(\`cmpt-\${tab}\`)?.classList.add('active');
        cmpfState.region = '';
        cmpfState.branch = '';
        renderCompliance();
      }`;

if (s.includes(switchOld) && !s.includes("state._cmpDrill = { view: tab")) {
  s = s.replace(switchOld, switchNew);
}

const winOld = `      window.switchCmpTab = switchCmpTab;
      window.renderCompliance = renderCompliance;`;
const winNew = `      window.switchCmpTab = switchCmpTab;
      window.renderCompliance = renderCompliance;
      window.cmpBackToRegions = cmpBackToRegions;
      window.cmpBackToBranches = cmpBackToBranches;
      window.cmpOpenRegionCompliance = cmpOpenRegionCompliance;
      window.cmpOpenBranchCompliance = cmpOpenBranchCompliance;`;

if (s.includes(winOld) && !s.includes('window.cmpOpenRegionCompliance')) {
  s = s.replace(winOld, winNew);
}

fs.writeFileSync(p, s, 'utf8');
console.log('Compliance card UI restored in index.html');
