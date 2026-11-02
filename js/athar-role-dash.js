/* ATHAR — role-specific home dashboards (desktop). Called from renderDashboardDesktopRedesign. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var band = function (n) { return n >= 90 ? ['ممتاز', 'ex'] : n >= 75 ? ['جيد', 'gd'] : n >= 60 ? ['متوسط', 'md'] : ['متعثر', 'bd']; };
  var chip = function (n) { var b = band(n); return '<span class="rd-rl-chip rd-rl-chip--' + b[1] + '">' + b[0] + '</span>'; };
  var num = function (n) { return '<span class="rd-rl-num">' + esc(n) + '</span>'; };
  var days = function (iso) { var t = Date.parse(iso || ''); return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 864e5)); };
  var avg = function (a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : 100; };

  function hero(title, score, line, kpis) {
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
      return { top: hero('امتثال الفرع · ' + branchName(me.branch_id), s, staff.length + ' موظفًا في الفرع', [[v.length, 'مخالفات الفرع هذا الشهر'], [v.filter(function (t) { return t.state === 'mgt'; }).length, 'تذاكر بانتظار الفرع'], [low.length, 'موظفون دون 75 نقطة']]),
        table: table('موظفون بحاجة لمتابعة', 'أقل من 75 نقطة هذا الشهر', ['الموظف', 'مخالفات الشهر', 'الامتثال', 'المؤشر'], low.slice(0, 8).map(function (u) { var sc = scoreOfEmp(u.id, all); return { cells: [esc(u.name), num(v.filter(function (t) { return t.employee_id === u.id; }).length), num(sc), chip(sc)] }; })) };
    }
    if (role === 'supervisor') {
      var rows = branchRows(state.branches || [], v, all);
      var need = rows.filter(function (r) { return r.s < 80; }).length;
      return { top: hero('مؤشر منطقتك', avg(rows.map(function (r) { return r.s; })), rows.length + ' فروع تحت إشرافك · ' + need + ' دون 80 نقطة', [[rows.length, 'فروع المنطقة'], [need, 'فروع تحتاج متابعة'], [rows.reduce(function (a, r) { return a + Number(r.cells[1].replace(/<[^>]+>/g, '')); }, 0), 'موظفًا']]),
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
      return { top: hero(role === 'admin' ? 'مؤشر امتثال الشركة' : 'مؤشر أداء المناطق', avg(rr.map(function (r) { return r.s; })), 'كل المناطق والفروع', kp),
        table: (role === 'admin' ? table('التذاكر حسب المرحلة', 'كل التذاكر المفتوحة الآن', ['المرحلة', 'تذاكر', 'متأخرة'], stages) : '') + table('أداء المناطق', 'مرتبة حسب الامتثال', HEAD_REGION, rr) };
    }
    if (role === 'auditor' || role === 'hr') {
      var key = role === 'auditor' ? 'aud' : 'hr';
      var waiting = v.filter(function (t) { return t.state === key; }).length;
      var closed = v.filter(function (t) { return t.state === 'closed'; }).length;
      var rate = v.length ? Math.round(closed / v.length * 100) : 100;
      return { top: hero(role === 'hr' ? 'نسبة إغلاق التذاكر' : 'مؤشر الامتثال العام', role === 'hr' ? rate : avg((state.branches || []).map(function (b) { return scoreOfBranch(b.id, all); })), waiting + ' تذاكر بانتظار مرحلتك · ' + overdue + ' متأخرة', [[waiting, role === 'hr' ? 'بانتظار الموارد البشرية' : 'بانتظار الرقابة'], [closed, role === 'hr' ? 'أُغلقت هذا الشهر' : 'مراجعتها هذا الشهر'], [overdue, 'متأخرة']]),
        table: table(role === 'hr' ? 'تذاكر بانتظار الموارد البشرية' : 'تذاكر بانتظار الرقابة الداخلية', 'الأقدم أولًا', HEAD_QUEUE, queue(v, key, all)) };
    }
    if (role === 'observer') {
      var mine = v.filter(function (t) { return t.observer_id === me.id; });
      var appr = mine.filter(function (t) { return String(t.status_text || '').indexOf('معتمد') >= 0 || t.state === 'closed'; }).length;
      var rej = mine.filter(function (t) { return String(t.status_text || '').indexOf('ملغ') >= 0; }).length;
      var pct = mine.length ? Math.round(appr / mine.length * 100) : 100;
      var wk = {}; mine.forEach(function (t) { var d = new Date(t.created_at); var w = Math.ceil(d.getDate() / 7); (wk[w] = wk[w] || []).push(t); });
      var wr = Object.keys(wk).sort().map(function (w) { var a = wk[w]; var ap = a.filter(function (t) { return String(t.status_text || '').indexOf('معتمد') >= 0 || t.state === 'closed'; }).length; var p = Math.round(ap / a.length * 100); return { cells: ['الأسبوع ' + w, num(a.length), num(ap), num(p + '%'), chip(p)] }; });
      return { top: hero('أداء الرصد', pct, mine.length + ' مخالفة مرصودة، اعتُمد منها ' + appr, [[mine.length, 'مرصودة'], [appr, 'معتمدة'], [rej, 'مرفوضة']]),
        table: table('أداء الرصد الأسبوعي', 'نسبة اعتماد ما رصدته', ['الأسبوع', 'المرصودة', 'المعتمدة', 'نسبة الاعتماد', 'المؤشر'], wr) };
    }
    return null;
  }

  window.AtharRoleDash = {
    apply: function (host, ctx) {
      try {
        var role = ctx.role;
        if (!host || !role || role === 'employee') return;
        var out = build(role, ctx);
        if (!out) return;
        var root = host.querySelector('.rd-desk-dash'); if (!root) return;
        root.classList.add('rd-desk-dash--role', 'rd-desk-dash--' + role);
        var pair = root.querySelector('.rd-desk-dash__pair'); if (pair) pair.outerHTML = out.top;
        var stats = root.querySelector('.rd-desk-stats'); if (stats) stats.remove();
        var main = root.querySelector('.rd-desk-dash__main'); if (main) main.insertAdjacentHTML('afterbegin', out.table);
      } catch (e) { try { console.warn('AtharRoleDash', e); } catch (_) { /* noop */ } }
    }
  };
})();
