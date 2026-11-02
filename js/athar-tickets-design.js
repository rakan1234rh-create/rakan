/* Tickets page — desktop design (W_Tickets). Renders on real data; actions proxy to the real ticket form. */
(function () {
  'use strict';
  var B = function () { return window.__atdBridge; };
  var S = { stage: -1, sel: null, loading: null, resp: {}, last: [] };
  var STAGES = ['emp', 'sup', 'mgt', 'aud', 'hr'];
  var NAMES = ['بانتظار رد الموظف', 'بانتظار رد المشرف', 'بانتظار القرار الإداري', 'بانتظار الرقابة الداخلية', 'بانتظار الموارد البشرية', 'مغلقة'];
  var STEPS = ['الموظف', 'المشرف', 'القرار الإداري', 'إدارة الرقابة الداخلية', 'الموارد البشرية', 'مغلقة'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stageOf(t) { var i = STAGES.indexOf(t.state); return i < 0 ? 5 : i; }
  function sevOf(t) {
    var b = B(), rec = null;
    try { rec = (b.state.violationTypes || []).find(function (x) { return x.name === t.violation_type; }); } catch (_) {}
    var s = b.violTypeSeverity(rec || t.violation_type || '');
    if (s === 'عالي') return ['hi', 'عالية'];
    if (s === 'متوسط') return ['med', 'متوسطة'];
    return ['low', 'منخفضة'];
  }
  function fdate(t) {
    var d = new Date(t.violation_date || t.created_at);
    if (isNaN(d)) return String(t.violation_date || '').slice(0, 10);
    try { return d.toLocaleDateString('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return d.toISOString().slice(0, 10); }
  }
  function panel() { return document.querySelector('#tab-workflow .wf-panel'); }
  function slot(id, before) {
    var p = panel(); if (!p) return null;
    var el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; p.insertBefore(el, before || p.firstChild); }
    return el;
  }
  function sevChip(sv) { return '<span class="atd-sev atd-sev--' + sv[0] + '">' + sv[1] + '</span>'; }

  function head() {
    var h = slot('atdHead'); if (!h) return;
    if (h.dataset.ok) return; h.dataset.ok = '1';
    h.innerHTML = '<div><p class="atd-kick">TICKET PROCESSING</p><h1 class="atd-h1">معالجة التذاكر</h1></div>';
  }
  function chips(all) {
    var c = slot('atdChips', document.getElementById('ticketList')); if (!c) return;
    var cnt = [0, 0, 0, 0, 0, 0]; all.forEach(function (t) { cnt[stageOf(t)]++; });
    var items = [{ l: 'الكل', v: -1, n: all.length }].concat(NAMES.map(function (n, i) { return { l: n, v: i, n: cnt[i] }; }));
    c.className = 'atd-chips'; c.setAttribute('aria-label', 'تصفية المراحل');
    c.innerHTML = items.map(function (x) {
      return '<button type="button" class="atd-chip" data-atd-stage="' + x.v + '" aria-pressed="' + (S.stage === x.v) + '"><span>' + esc(x.l) + '</span><b>' + x.n + '</b></button>';
    }).join('');
  }

  function render(tickets, host) {
    var b = B(); if (!b) throw new Error('no bridge');
    S.last = tickets; head();
    var all = tickets.slice();
    chips(all);
    var list = S.stage === -1 ? all : all.filter(function (t) { return stageOf(t) === S.stage; });
    var sel = list.filter(function (t) { return t.id === S.sel; })[0] || list[0] || null;
    S.sel = sel ? sel.id : null;
    host.classList.add('atd-host');
    if (!list.length) {
      host.innerHTML = '<div class="atd-card atd-empty"><b>لا توجد تذاكر في هذه المرحلة</b></div>';
      return;
    }
    var rows = list.map(function (t) {
      var on = t.id === S.sel, st = stageOf(t), sv = sevOf(t);
      return '<button type="button" class="atd-row" data-atd-pick="' + esc(t.id) + '" aria-pressed="' + on + '">' +
        '<span class="atd-row__main"><span class="atd-mono">#' + esc(b.shortTicketNum(t.ticket_number)) + '</span><span class="atd-row__type">' + esc(t.violation_type) + '</span>' +
        '<span class="atd-mu">' + esc(t._empName) + ' · ' + esc(t._branchName) + ' · ' + esc(fdate(t)) + '</span></span>' +
        '<span class="atd-row__end">' + sevChip(sv) + '<span class="atd-pill' + (st === 5 ? ' is-closed' : '') + '">' + esc(NAMES[st]) + '</span></span></button>';
    }).join('');
    host.innerHTML = '<div class="atd-grid"><div class="atd-card atd-list">' + rows + '</div><aside class="atd-card atd-aside" id="atdAside" aria-label="تفاصيل التذكرة"></aside></div>';
    if (S.loading !== S.sel && (!b.state.editingTicket || b.state.editingTicket.id !== S.sel)) load(S.sel); else aside();
  }

  function load(id) {
    if (!id || typeof window.openTicket !== 'function') return aside();
    S.loading = id; document.body.classList.add('atd-loading');
    var fin = function () {
      document.body.classList.remove('atd-loading');
      try { window.closeModal('ticketModal'); } catch (_) {}
      if (S.loading === id) { S.loading = null; aside(); }
    };
    Promise.resolve(window.openTicket(id)).then(fin, fin);
    aside();
  }

  function aside() {
    var el = document.getElementById('atdAside'), b = B(); if (!el || !b) return;
    var t = (b.state.violations || []).filter(function (v) { return v.id === S.sel; })[0];
    if (!t) { el.innerHTML = ''; return; }
    var st = stageOf(t), sv = sevOf(t);
    var atts = []; try { atts = b.getVisibleAttachments(t) || []; } catch (_) {}
    var files = atts.map(function (a, i) {
      var nm = a.name || a.n || a.filename || ('مرفق ' + (i + 1));
      var sz = a.size ? (a.size > 1048576 ? (a.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(a.size / 1024)) + ' KB') : '';
      return '<div class="atd-file"><span class="atd-file__n">' + esc(nm) + (sz ? ' <span class="atd-mono">' + sz + '</span>' : '') + '</span><button type="button" class="atd-btn atd-btn--sm" data-atd-view="' + i + '">عرض</button></div>';
    }).join('');
    var steps = STEPS.map(function (n, i) {
      var done = i < st, now = i === st;
      return '<li class="atd-step"><div class="atd-step__rail"><i class="atd-dot ' + (done ? 'is-done' : now ? 'is-now' : '') + '"></i><i class="atd-line' + (i < st ? ' is-done' : '') + '"></i></div><div class="atd-step__t"><div class="' + (now ? 'is-now' : done ? '' : 'is-off') + '">' + esc(n) + '</div><div class="atd-mu">' + (done ? 'تم' : now ? (st === 5 ? 'أُغلقت التذكرة' : 'بانتظار الإجراء') : '') + '</div></div></li>';
    }).join('');
    var btns = [];
    if (b.state.editingTicket && b.state.editingTicket.id === t.id && S.loading !== t.id) {
      var form = document.getElementById('respText'); var wrap = document.getElementById('responseButtons');
      var real = wrap ? wrap.querySelectorAll('.td-resp-action') : [];
      var hidden = form && form.closest('form, .td-resp-form, #respForm') && getComputedStyle(form.closest('form, .td-resp-form, #respForm')).display === 'none';
      if (!hidden) real.forEach(function (r, i) {
        if (r.disabled) return;
        var m = (r.getAttribute('onclick') || '').match(/'([a-z_]+)'/); var act = m ? m[1] : '';
        var lbl = /warning/.test(act) ? 'تنبيه' : /delete|cancel/.test(act) ? 'إلغاء' : /approve|forward|send|pass|emp_reply|sup_/.test(act) ? 'تمرير' : (r.textContent || '').trim();
        var kind = /warning/.test(act) ? 'g' : /delete|cancel/.test(act) ? 'm' : 'p';
        btns.push('<button type="button" class="atd-btn atd-btn--' + kind + '" data-atd-act="' + i + '">' + esc(lbl) + '</button>');
      });
    }
    var act = btns.length ? '<div class="atd-act"><span class="atd-act__t">إجراء مرحلة ' + esc(NAMES[st]) + '</span><textarea class="atd-ta" id="atdResp" rows="3" placeholder="اكتب الرد أو ملاحظات القرار…">' + esc(S.resp[t.id] || '') + '</textarea><div class="atd-act__b">' + btns.join('') + '</div></div>' : '';
    el.innerHTML =
      '<div class="atd-a-head"><span class="atd-mono atd-kk">TICKET #' + esc(b.shortTicketNum(t.ticket_number)) + '</span><h2 class="atd-h2">' + esc(t.violation_type) + '</h2><div class="atd-a-meta">' + sevChip(sv) + '<span class="atd-mu">' + esc(fdate(t)) + '</span></div></div>' +
      '<div class="atd-info"><div><div class="atd-mu">الموظف</div><div class="atd-v">' + esc(t._empName) + '</div></div><div><div class="atd-mu">الفرع</div><div class="atd-v">' + esc(t._branchName) + '</div></div>' +
      (b.hideObs() ? '' : '<div><div class="atd-mu">الراصد</div><div class="atd-v">' + esc(t._obsName || '-') + '</div></div>') +
      '<div><div class="atd-mu">المرحلة الحالية</div><div class="atd-v">' + esc(NAMES[st]) + '</div></div></div>' +
      '<p class="atd-desc">' + esc(t.description || '—') + '</p>' +
      '<div><h3 class="atd-h3">المرفقات</h3>' + (files || '<div class="atd-mu atd-nofile">لا توجد مرفقات</div>') + '</div>' +
      '<ol class="atd-steps" aria-label="مسار التذكرة">' + steps + '</ol>' + act;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-atd-stage],[data-atd-pick],[data-atd-view],[data-atd-act]'); if (!t) return;
    var b = B(); if (!b) return;
    if (t.hasAttribute('data-atd-stage')) { S.stage = +t.getAttribute('data-atd-stage'); S.sel = null; b.refilter(); }
    else if (t.hasAttribute('data-atd-pick')) { S.sel = t.getAttribute('data-atd-pick'); b.refilter(); }
    else if (t.hasAttribute('data-atd-view')) { if (typeof window.openAttViewerByIndex === 'function') window.openAttViewerByIndex(+t.getAttribute('data-atd-view')); }
    else if (t.hasAttribute('data-atd-act')) {
      var ta = document.getElementById('atdResp'), real = document.getElementById('respText');
      if (real && ta) real.value = ta.value;
      var r = document.querySelectorAll('#responseButtons .td-resp-action')[+t.getAttribute('data-atd-act')];
      if (r) r.click();
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'atdResp') { S.resp[S.sel] = e.target.value; var r = document.getElementById('respText'); if (r) r.value = e.target.value; }
  });
  window.AtharTicketsDesign = { render: render, sevOf: sevOf, fdate: fdate, esc: esc };
})();
