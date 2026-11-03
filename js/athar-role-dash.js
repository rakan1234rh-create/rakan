/* ATHAR — role-specific home dashboards (desktop). Called from renderDashboardDesktopRedesign. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var band = function (n) { return n >= 90 ? ['ممتاز', 'ex'] : n >= 75 ? ['جيد', 'gd'] : n >= 50 ? ['متوسط', 'md'] : ['متعثر', 'bd']; };
  var chip = function (n) { var b = band(n); return '<span class="rd-rl-chip rd-rl-chip--' + b[1] + '">' + b[0] + '</span>'; };
  var num = function (n) { return '<span class="rd-rl-num">' + esc(n) + '</span>'; };
  var days = function (iso) { var t = Date.parse(iso || ''); return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 864e5)); };
  var avg = function (a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : 100; };

  function hero(title, score, line, kpis) { return { title: title, score: score, line: line, kpis: kpis }; }
  function heroOld(title, score, line, kpis) {
    return '<div class="rd-rl-hero"><div class="rd-rl-score">' +
      '<div class="rd-rl-score__t">' + esc(title) + '</div>' +
      '<div class="rd-rl-score__v">' + num(score) + chip(score) + '</div>' +
      '<div class="rd-rl-score__s">' + esc(line) + '</div>' +
      '<div class="rd-rl-bar"><i style="width:' + Math.max(0, Math.min(100, score)) + '%"></i></div></div>' +
      '<div class="rd-rl-kpis">' + kpis.map(function (k) {
        return '<div class="rd-rl-kpi"><div class="rd-rl-kpi__v">' + num(k[0]) + '</div><div class="rd-rl-kpi__l">' + esc(k[1]) + '</div></div>';
      }).join('') + '</div></div>';
  }
  function table(title, sub, head, rows, onrow) {
    return '<div class="rd-desk-sec"><div class="rd-desk-sec__head"><span class="rd-desk-sec__title">' + esc(title) + '</span>' +
      '<span class="rd-rl-sub">' + esc(sub || '') + '</span></div>' +
      '<div class="rd-rl-table"><div class="rd-rl-tr rd-rl-tr--h" style="--c:' + head.length + '">' + head.map(function (h) { return '<span>' + esc(h) + '</span>'; }).join('') + '</div>' +
      (rows.length ? rows.map(function (r) {
        return '<div class="rd-rl-tr"' + (r.click ? ' role="button" tabindex="0" onclick="' + r.click + '"' : '') + ' style="--c:' + head.length + '">' + r.cells.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>';
      }).join('') : '<div class="rd-rl-empty">لا توجد بيانات</div>') + '</div></div>';
  }

  function scoreOfEmp(id, all) { try { return Number(calcEmpScore(id, all).score) || 0; } catch (_) { return 100; } }
  function scoreOfBranch(id, all) { try { return Math.round(Number(calcBranchSafety(id, all).score) || 0); } catch (_) { return 100; } }
  function branchName(id) { var b = (state.branches || []).find(function (x) { return String(x.id) === String(id); }); return b ? b.name : '—'; }

  function branchRows(branches, visible, all) {
    return branches.map(function (b) {
      var vs = visible.filter(function (v) { return String(v.branch_id) === String(b.id); });
      var staff = (state.users || []).filter(function (u) { return String(u.branch_id) === String(b.id) && u.role === 'employee'; }).length;
      var s = scoreOfBranch(b.id, all);
      return { b: b, s: s, cells: [esc(b.name), num(staff), num(vs.length), num(vs.filter(isTicketWorkflowOpen).length), num(s), chip(s)] };
    }).sort(function (a, b) { return b.s - a.s; });
  }
  function regionRows(visible, all) {
    return (state.regions || []).map(function (r) {
      var brs = (state.branches || []).filter(function (b) { return String(b.region_id) === String(r.id); });
      var ids = brs.map(function (b) { return String(b.id); });
      var vs = visible.filter(function (v) { return ids.indexOf(String(v.branch_id)) >= 0; });
      var s = avg(brs.map(function (b) { return scoreOfBranch(b.id, all); }));
      return { s: s, cells: [esc(r.name), num(brs.length), num(vs.length), num(vs.filter(isTicketWorkflowOpen).length), num(s), chip(s)] };
    }).filter(function (r) { return r.cells; }).sort(function (a, b) { return b.s - a.s; });
  }
  function queue(visible, key, all) {
    return visible.filter(function (v) { return v.state === key; })
      .sort(function (a, b) { return Date.parse(a.updated_at || a.created_at) - Date.parse(b.updated_at || b.created_at); })
      .slice(0, 8).map(function (v) {
        var s = scoreOfEmp(v.employee_id, all);
        return { click: "openTicket('" + esc(v.id) + "')", cells: [esc(v.violation_type || '—'), esc(v._empName || '—') + ' · ' + esc(v._branchName || branchName(v.branch_id)), num(days(v.updated_at || v.created_at)), num(s), chip(s)] };
      });
  }

  var HEAD_BRANCH = ['الفرع', 'الموظفون', 'المخالفات', 'تذاكر مفتوحة', 'الامتثال', 'المؤشر'];
  var HEAD_REGION = ['المنطقة', 'الفروع', 'المخالفات', 'تذاكر مفتوحة', 'الامتثال', 'المؤشر'];
  var HEAD_QUEUE = ['المخالفة', 'الموظف والفرع', 'أيام الانتظار', 'امتثال الموظف', 'المؤشر'];

  function build(role, ctx) {
    var me = ctx.me, v = ctx.visible, all = ctx.allVisible || v;
    var open = v.filter(isTicketWorkflowOpen);
    var overdue = open.filter(function (t) { return days(t.updated_at || t.created_at) > 3; }).length;
    if (role === 'branch_manager') {
      var staff = (state.users || []).filter(function (u) { return String(u.branch_id) === String(me.branch_id) && u.role === 'employee'; });
      var low = staff.filter(function (u) { return scoreOfEmp(u.id, all) < 75; });
      var s = scoreOfBranch(me.branch_id, all);
      return { hero: hero('امتثال الفرع · ' + branchName(me.branch_id), s, staff.length + ' موظفًا في الفرع', [[v.length, 'مخالفات الفرع هذا الشهر'], [v.filter(function (t) { return t.state === 'mgt'; }).length, 'تذاكر بانتظار الفرع'], [low.length, 'موظفون دون 75 نقطة']]),
        table: table('موظفون بحاجة لمتابعة', 'أقل من 75 نقطة هذا الشهر', ['الموظف', 'مخالفات الشهر', 'الامتثال', 'المؤشر'], low.slice(0, 8).map(function (u) { var sc = scoreOfEmp(u.id, all); return { cells: [esc(u.name), num(v.filter(function (t) { return t.employee_id === u.id; }).length), num(sc), chip(sc)] }; })) };
    }
    if (role === 'supervisor') {
      var supIds = (me.supervisedBranches || []).map(String);
      var rows = branchRows((state.branches || []).filter(function (b) { return supIds.indexOf(String(b.id)) >= 0; }), v, all);
      var need = rows.filter(function (r) { return r.s < 80; }).length;
      return { hero: hero('مؤشر منطقتك', avg(rows.map(function (r) { return r.s; })), rows.length + ' فروع تحت إشرافك · ' + need + ' دون 80 نقطة', [[rows.length, 'فروع المنطقة'], [need, 'فروع تحتاج متابعة'], [rows.reduce(function (a, r) { return a + Number(r.cells[1].replace(/<[^>]+>/g, '')); }, 0), 'موظفًا']]),
        table: table('فروع المنطقة', 'مرتبة حسب مؤشر الامتثال هذا الشهر', HEAD_BRANCH, rows) };
    }
    if (role === 'manager' || role === 'admin') {
      var rr = regionRows(v, all);
      var kp = role === 'admin'
        ? [[(state.users || []).length, 'مستخدمًا'], [(state.branches || []).length, 'فرعًا'], [open.length, 'تذكرة مفتوحة']]
        : [[rr.length, 'مناطق'], [(state.branches || []).length, 'فرعًا'], [(state.users || []).filter(function (u) { return u.role === 'employee'; }).length, 'موظفًا']];
      var stages = [['emp', 'بانتظار الموظف'], ['sup', 'بانتظار المشرف'], ['mgt', 'بانتظار الإدارة'], ['aud', 'بانتظار الرقابة الداخلية'], ['hr', 'بانتظار الموارد البشرية']].map(function (k) {
        var c = v.filter(function (t) { return t.state === k[0]; }); var od = c.filter(function (t) { return days(t.updated_at || t.created_at) > 3; }).length;
        return { cells: [esc(k[1]), num(c.length), num(od)] };
      });
      return { hero: hero(role === 'admin' ? 'مؤشر امتثال الشركة' : 'مؤشر أداء المناطق', avg(rr.map(function (r) { return r.s; })), 'كل المناطق والفروع', kp),
        table: (role === 'admin' ? table('التذاكر حسب المرحلة', 'كل التذاكر المفتوحة الآن', ['المرحلة', 'تذاكر', 'متأخرة'], stages) : '') + table('أداء المناطق', 'مرتبة حسب الامتثال', HEAD_REGION, rr) };
    }
    if (role === 'auditor' || role === 'hr') {
      var key = role === 'auditor' ? 'aud' : 'hr';
      var waiting = v.filter(function (t) { return t.state === key; }).length;
      var closed = v.filter(function (t) { return t.state === 'closed'; }).length;
      var rate = v.length ? Math.round(closed / v.length * 100) : 100;
      return { hero: hero(role === 'hr' ? 'نسبة إغلاق التذاكر' : 'مؤشر الامتثال العام', role === 'hr' ? rate : avg((state.branches || []).map(function (b) { return scoreOfBranch(b.id, all); })), waiting + ' تذاكر بانتظار مرحلتك · ' + overdue + ' متأخرة', [[waiting, role === 'hr' ? 'بانتظار الموارد البشرية' : 'بانتظار الرقابة'], [closed, role === 'hr' ? 'أُغلقت هذا الشهر' : 'مراجعتها هذا الشهر'], [overdue, 'متأخرة']]),
        table: table(role === 'hr' ? 'تذاكر بانتظار الموارد البشرية' : 'تذاكر بانتظار الرقابة الداخلية', 'الأقدم أولًا', HEAD_QUEUE, queue(v, key, all)) };
    }
    if (role === 'observer') {
      var mine = v.filter(function (t) { return t.observer_id === me.id; });
      var appr = mine.filter(function (t) { return String(t.status_text || '').indexOf('معتمد') >= 0 || t.state === 'closed'; }).length;
      var rej = mine.filter(function (t) { return String(t.status_text || '').indexOf('ملغ') >= 0; }).length;
      var pct = mine.length ? Math.round(appr / mine.length * 100) : 100;
      var wk = {}; mine.forEach(function (t) { var d = new Date(t.created_at); var w = Math.ceil(d.getDate() / 7); (wk[w] = wk[w] || []).push(t); });
      var wr = Object.keys(wk).sort().map(function (w) { var a = wk[w]; var ap = a.filter(function (t) { return String(t.status_text || '').indexOf('معتمد') >= 0 || t.state === 'closed'; }).length; var p = Math.round(ap / a.length * 100); return { cells: ['الأسبوع ' + w, num(a.length), num(ap), num(p + '%'), chip(p)] }; });
      return { hero: hero('أداء الرصد', pct, mine.length + ' مخالفة مرصودة، اعتُمد منها ' + appr, [[mine.length, 'مرصودة'], [appr, 'معتمدة'], [rej, 'مرفوضة']]),
        table: table('أداء الرصد الأسبوعي', 'نسبة اعتماد ما رصدته', ['الأسبوع', 'المرصودة', 'المعتمدة', 'نسبة الاعتماد', 'المؤشر'], wr) };
    }
    return null;
  }

  var STAGE = { emp: 'بانتظار الموظف', sup: 'بانتظار المشرف', mgt: 'بانتظار الإدارة', aud: 'بانتظار الرقابة الداخلية', hr: 'بانتظار الموارد البشرية', closed: 'مغلقة', Warning_Issued: 'تنبيه إداري صادر' };
  var ROLE_STAGE = { employee: 'emp', supervisor: 'sup', branch_manager: 'mgt', manager: 'mgt', auditor: 'aud', hr: 'hr' };
  var ROLE_LABEL = { employee: 'موظف', supervisor: 'مشرف', branch_manager: 'مدير فرع', manager: 'مدير', observer: 'راصد', admin: 'مدير النظام', auditor: 'الرقابة الداخلية', hr: 'الموارد البشرية' };
  var COL = { ex: '#1E9E6A', gd: '#2F6FD6', md: '#E8A317', bd: '#D6322B' };

  function ring(score) {
    var C = 301.6, b = band(score)[1];
    return '<div class="rd-h-ring"><svg width="124" height="124" viewBox="0 0 124 124" aria-hidden="true"><circle cx="62" cy="62" r="48" fill="none" stroke="var(--hm-sf)" stroke-width="10"/>' +
      '<circle cx="62" cy="62" r="48" fill="none" stroke="' + COL[b] + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C - C * Math.max(0, Math.min(100, score)) / 100) + '" transform="rotate(-90 62 62)"/></svg><span class="rd-h-ring__n">' + esc(score) + '</span></div>';
  }
  function bandBar(score) {
    var seg = [['bd', 50, 'متعثر (<50)'], ['md', 25, 'متوسط (50-74)'], ['gd', 15, 'جيد (75-89)'], ['ex', 10, 'ممتاز (90+)']];
    return '<div class="rd-h-band"><div class="rd-h-band__bar">' + seg.map(function (g) { return '<i style="flex:' + g[1] + ';background:' + COL[g[0]] + '"></i>'; }).join('') +
      '<b style="inset-inline-start:' + Math.max(0, Math.min(100, score)) + '%"></b></div><div class="rd-h-band__lg">' +
      seg.map(function (g) { return '<span><u style="background:' + COL[g[0]] + '"></u>' + g[2] + '</span>'; }).join('') + '</div></div>';
  }
  function heroCard(h) {
    var b = band(h.score);
    return '<section class="rd-h-card rd-h-hero"><div class="rd-h-card__t">' + esc(h.title) + '</div>' +
      '<div class="rd-h-hero__row">' + ring(h.score) + '<div class="rd-h-hero__txt"><span class="rd-rl-chip rd-rl-chip--' + b[1] + '">' + b[0] + '</span><p>' + esc(h.line) + '</p></div></div>' +
      bandBar(h.score) +
      '<div class="rd-h-stats">' + h.kpis.map(function (k) { return '<div><div class="rd-h-stats__v">' + num(k[0]) + '</div><div class="rd-h-stats__l">' + esc(k[1]) + '</div></div>'; }).join('') + '</div></section>';
  }
  function rankCard(me, all, branchAll) {
    /* branch manager only: ranking of the branch employees, scored from the whole branch scope */
    var staff = (typeof getBranchStaff === 'function' ? getBranchStaff(me.branch_id) : []).filter(function (u) { return u.role === 'employee'; });
    var scope = branchAll || all;
    if (!staff.some(function (u) { return u.id === me.id; })) staff.push(me);
    var list = staff.map(function (u) { return { u: u, s: scoreOfEmp(u.id, scope), me: u.id === me.id }; }).sort(function (a, b) { return b.s - a.s; });
    return '<section class="rd-h-card"><div class="rd-h-rank"><div><div class="rd-h-card__t">ترتيب موظفي الفرع</div><div class="rd-rl-sub">' + esc(branchName(me.branch_id)) + ' · ' + (list.length - 1) + ' موظف + أنت</div></div></div><div class="rd-h-list">' +
      list.slice(0, 10).map(function (r, i) { var b = band(r.s)[1]; return '<div class="rd-h-list__r' + (r.me ? ' is-me' : '') + '"><span class="rd-rl-num rd-h-mu">' + (i + 1) + '</span><span>' + esc(r.u.name) + (r.me ? ' <em class="rd-h-me">أنت · مدير الفرع</em>' : '') + '</span><span class="rd-h-meter"><i style="width:' + Math.max(0, Math.min(100, r.s)) + '%;background:' + COL[b] + '"></i></span><span class="rd-rl-num">' + r.s + '</span></div>'; }).join('') +
      (list.length ? '' : '<div class="rd-rl-empty">لا توجد بيانات</div>') + '</div></section>';
  }
  function recentCard(title, items) {
    return '<section class="rd-h-card"><div class="rd-desk-sec__head"><span class="rd-desk-sec__title">' + esc(title) + '</span><button type="button" class="rd-desk-sec__link" onclick="dashGoTab(\'workflow\')">كل التذاكر</button></div><div class="rd-h-list">' +
      (items.length ? items.map(function (t) {
        var sc = (typeof calcEmpScore === 'function') ? '' : '';
        return '<button type="button" class="rd-h-tk" onclick="openTicket(\'' + esc(t.id) + '\')"><span><b>' + esc(t.violation_type || '—') + '</b><small>' + esc(formatRelativeAr(t.created_at)) + (t._empName ? ' · ' + esc(t._empName) : '') + '</small></span><span class="rd-h-pill">' + esc(STAGE[t.state] || t.state || '—') + '</span></button>';
      }).join('') : '<div class="rd-rl-empty">لا توجد تذاكر بعد</div>') + '</div></section>';
  }
  function notifCard() {
    var n = (state.notifications || []).slice(0, 4);
    return '<section class="rd-h-card"><div class="rd-desk-sec__head"><span class="rd-desk-sec__title">آخر الإشعارات</span></div><div class="rd-h-list">' +
      (n.length ? n.map(function (x) { return '<div class="rd-h-nt"><span>' + esc(x.title || x.message || '') + '</span><small>' + esc(formatRelativeAr(x.created_at)) + '</small></div>'; }).join('') : '<div class="rd-rl-empty">لا توجد إشعارات</div>') + '</div></section>';
  }
  function personal(role, ctx) {
    var me = ctx.me, v = ctx.visible, all = ctx.allVisible || v;
    var sc = (typeof calcEmpScore === 'function') ? calcEmpScore(me.id, all) : { score: 100, deducted: 0 };
    var score = Math.round(Number(sc.score) || 0), ded = Math.round(Number(sc.deducted) || 0);
    var mine = v.filter(function (t) { return t.employee_id === me.id; });
    var next = score >= 90 ? null : score >= 75 ? [90, 'ممتاز'] : score >= 50 ? [75, 'جيد'] : [50, 'متوسط'];
    var line = (ded > 0 ? 'خُصم منك ' + ded + ' نقاط هذا الشهر. ' : 'لا خصم عليك هذا الشهر. ') + (next ? 'تبقّى ' + (next[0] - score) + ' نقاط للوصول إلى «' + next[1] + '».' : 'أنت في أعلى فئة.');
    var stage = ROLE_STAGE[role];
    return { title: 'مؤشر امتثالي', score: score, line: line, kpis: [[mine.length, 'مخالفاتي هذا الشهر'], [stage ? v.filter(function (t) { return t.state === stage; }).length : 0, 'بانتظار إجرائي'], [mine.filter(function (t) { return t.state === 'closed'; }).length, 'مغلقة']], mine: mine };
  }
  function tiles(arr) {
    return '<div class="rd-rl-kpis rd-h-tiles">' + arr.map(function (k) { return '<div class="rd-rl-kpi"><div class="rd-rl-kpi__v">' + num(k[0]) + '</div><div class="rd-rl-kpi__l">' + esc(k[1]) + '</div></div>'; }).join('') + '</div>';
  }
  function header(me, role) {
    var d = new Date(); var kick = ['', ''];
    var en = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '').toUpperCase();
    var place = role === 'employee' || role === 'branch_manager' ? branchName(me.branch_id) : (ROLE_LABEL[role] || '');
    return '<div class="rd-h-head"><div class="rd-h-head__t"><div class="rd-h-kick">' + esc(en) + ' · ' + esc(place) + '</div><h1>مرحبًا، ' + esc(String(me.name || '').split(' ')[0]) + '</h1></div>' +
      '</div>';
  }

  function curTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function syncPill(box) { var t = curTheme(); box.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.t === t); b.setAttribute('aria-pressed', b.dataset.t === t ? 'true' : 'false'); }); }
  function mountThemePill() {
    var zone = document.querySelector('.topbar-actions-zone'); if (!zone || zone.querySelector('.rd-h-theme')) return;
    var box = document.createElement('div'); box.className = 'rd-h-theme rd-h-theme--top'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'المظهر');
    box.innerHTML = '<button type="button" data-t="light" aria-label="فاتح"><i class="fas fa-sun"></i></button><button type="button" data-t="dark" aria-label="داكن"><i class="fas fa-moon"></i></button>';
    box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.t !== curTheme() && typeof toggleTheme === 'function') toggleTheme(e); setTimeout(function () { syncPill(box); }, 50); });
    zone.insertBefore(box, zone.firstChild); syncPill(box);
    new MutationObserver(function () { syncPill(box); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function mountTicketClose() {
    var card = document.querySelector('#ticketModal .modal-card'); if (!card || card.querySelector('.rd-tk-close')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'rd-tk-close no-print'; b.setAttribute('aria-label', 'إغلاق'); b.innerHTML = '<i class="fas fa-xmark"></i>';
    b.addEventListener('click', function () { if (typeof closeModal === 'function') closeModal('ticketModal'); });
    card.appendChild(b);
  }
  setInterval(mountTicketClose, 1500);
  /* complaints: show the existing new-complaint form docked beside the list (design) */
  var cmplDocked = false;
  setInterval(function () {
    try {
      if (!document.documentElement.classList.contains('mr-desktop-ui')) return;
      var tab = document.getElementById('tab-complaints'); var m = document.getElementById('newComplaintModal'); if (!tab || !m) return;
      var vis = !tab.hidden && tab.offsetParent !== null;
      if (window.__cmplDesign) return;
      if (vis && !cmplDocked && !m.classList.contains('open') && typeof canSubmitComplaint === 'function' && canSubmitComplaint() && typeof openNewComplaintModal === 'function') { cmplDocked = true; openNewComplaintModal(); }
      if (!vis && cmplDocked) { cmplDocked = false; if (m.classList.contains('open') && typeof closeModal === 'function') closeModal('newComplaintModal'); }
    } catch (_) { /* noop */ }
  }, 700);
  var tries = 0; (function wait() { mountThemePill(); if (!document.querySelector('.rd-h-theme--top') && tries++ < 60) setTimeout(wait, 500); })();

  window.AtharRoleDash = {
    apply: function (host, ctx) {
      try {
        var role = ctx.role, me = ctx.me;
        if (!host || !role || !me) return;
        var root = host.querySelector('.rd-desk-dash'); if (!root) return;
        var v = ctx.visible, all = ctx.allVisible || v;
        var hasPersonal = role === 'employee' || role === 'branch_manager';
        var extra = role === 'employee' ? null : build(role, ctx);
        var p = hasPersonal ? personal(role, ctx) : null;
        var top, recent;
        if (hasPersonal) {
          top = heroCard(p) + (role === 'branch_manager' ? rankCard(me, all, ctx.branchAll) : '');
          recent = p.mine.slice(0, 5);
        } else if (extra) {
          top = heroCard(extra.hero) + notifCard();
          recent = v.slice(0, 5);
        }
        var rows2 = hasPersonal ? recentCard('آخر تذاكري', recent) + notifCard() : recentCard('آخر التذاكر', recent);
        var html = header(me, role) + '<div class="rd-h-row rd-h-row--a' + (hasPersonal && role !== 'branch_manager' ? ' rd-h-row--1' : '') + '">' + top + '</div>' +
          '<div class="rd-h-row rd-h-row--b">' + rows2 + '</div>' +
          (extra ? (role === 'branch_manager' ? tiles(extra.hero.kpis) : '') + extra.table : '');
        root.classList.add('rd-desk-dash--h');
        root.innerHTML = html;
      } catch (e) { try { console.warn('AtharRoleDash', e); } catch (_) { /* noop */ } }
    }
  };
})();
