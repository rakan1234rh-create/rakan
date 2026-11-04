/* Tickets page — desktop design (W_Tickets). Renders on real data; actions proxy to the real ticket form. */
(function () {
  'use strict';
  var B = function () { return window.__atdBridge; };
  var S = { sel: null, loading: null, resp: {}, last: [] };
  var STAGES = ['emp', 'sup', 'mgt', 'aud', 'hr'];
  var NAMES = ['بانتظار رد الموظف', 'بانتظار رد المشرف', 'بانتظار القرار الإداري', 'بانتظار الرقابة الداخلية', 'بانتظار الموارد البشرية', 'معتمدة', 'تنبيه', 'ملغاة', 'مغلقة'];
  var TONE = ['', '', '', '', '', 'ok', 'warn', 'bad', 'closed'];
  var STEPS = ['الموظف', 'المشرف', 'القرار الإداري', 'إدارة الرقابة الداخلية', 'معتمدة'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stageOf(t) {
    if (t.state === 'hr') return 5; /* HR stage retired: treated as final approval */
    var i = STAGES.indexOf(t.state); if (i >= 0) return i;
    var o = null; try { o = B().terminal(t); } catch (_) {}
    if (o === 'warn') return 6; if (o === 'cancel') return 7;
    return /معتمد/.test(String(t.status_text || '')) ? 5 : 8;
  }
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
  var SHORT = ['رد الموظف', 'رد المشرف', 'قرار الإدارة', 'الرقابة الداخلية', 'الموارد البشرية', 'معتمدة', 'تنبيه', 'ملغاة', 'مغلقة'];
  var STAGE_OPTS = ['بانتظار رد الموظف', 'بانتظار رد المشرف', 'بانتظار القرار الإداري', 'بانتظار الرقابة الداخلية'];
  var STATUS_OPTS = [['open', 'قيد المعالجة'], ['5', 'معتمدة'], ['6', 'تنبيه'], ['7', 'ملغاة'], ['8', 'مغلقة']];
  S.f = { branch: '', emp: '', stage: '', status: '', from: '', to: '' };
  function passes(t) {
    var f = S.f, st = stageOf(t);
    if (f.branch && t._branchName !== f.branch) return false;
    if (f.emp && t._empName !== f.emp) return false;
    if (f.stage !== '' && st !== +f.stage) return false;
    if (f.status === 'open' && st > 4) return false;
    if (f.status !== '' && f.status !== 'open' && st !== +f.status) return false;
    return true;
  }
  function activeCount() { var f = S.f; return ['branch', 'emp', 'stage', 'status'].filter(function (k) { return f[k] !== ''; }).length + (f.from && f.to ? 1 : 0); }
  function uniq(list, k) { var m = {}; list.forEach(function (t) { if (t[k]) m[t[k]] = 1; }); return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'ar'); }); }
  function opts(arr, cur) { return '<option value="">الكل</option>' + arr.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }
  function fld(label, inner) { return '<label class="atd-fld"><span>' + label + '</span>' + inner + '</label>'; }
  function tagsHtml() {
    var f = S.f, t = [];
    if (f.branch) t.push(['branch', 'الفرع: ' + f.branch]); if (f.emp) t.push(['emp', 'الموظف: ' + f.emp]);
    if (f.from && f.to) t.push(['period', 'الفترة: ' + f.from + ' → ' + f.to]);
    if (f.stage !== '') t.push(['stage', STAGE_OPTS[+f.stage]]);
    if (f.status !== '') t.push(['status', (STATUS_OPTS.filter(function (o) { return o[0] === f.status; })[0] || [0, ''])[1]]);
    return t.map(function (x) { return '<button type="button" class="atd-tag" data-atd-clear="' + x[0] + '">' + esc(x[1]) + ' <i aria-hidden="true">×</i></button>'; }).join('') +
      (t.length > 1 ? '<button type="button" class="atd-tag atd-tag--all" data-atd-clear="all">مسح الكل</button>' : '');
  }
  function chips(all) {
    var tb = document.getElementById('wfClassicToolbar'); if (!tb) return;
    var n = activeCount(), btn = document.getElementById('atdFilterBtn');
    if (!btn) {
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'atdFilterBtn'; btn.className = 'atd-fbtn'; btn.setAttribute('aria-haspopup', 'dialog');
      tb.appendChild(btn);
      var pop = document.createElement('div'); pop.id = 'atdFilterPop'; pop.className = 'atd-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'تصفية التذاكر');
      tb.appendChild(pop);
    }
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4"/></svg><span>تصفية</span>' + (n ? '<b>' + n + '</b>' : '');
    var pop2 = document.getElementById('atdFilterPop');
    if (!pop2.hidden && !pop2.contains(document.activeElement)) fillPop(all);
    else if (pop2.hidden) pop2.dataset.dirty = '1';
    var c = slot('atdChips', document.getElementById('ticketList')); if (!c) return;
    c.className = 'atd-tags'; c.innerHTML = tagsHtml(); c.hidden = !n;
  }
  function fillPop(all) {
    var p = document.getElementById('atdFilterPop'); if (!p) return;
    var f = S.f, src = S.base || all;
    p.innerHTML = '<div class="atd-pop__grid">' +
      fld('الفرع', '<select data-atd-f="branch">' + opts(uniq(src, '_branchName'), f.branch) + '</select>') +
      fld('الموظف', '<select data-atd-f="emp">' + opts(uniq(src, '_empName'), f.emp) + '</select>') +
      fld('الفترة من', '<input type="date" data-atd-f="from" value="' + esc(f.from) + '">') +
      fld('الفترة إلى', '<input type="date" data-atd-f="to" value="' + esc(f.to) + '">') +
      fld('المرحلة', '<select data-atd-f="stage">' + opts(STAGE_OPTS.map(function (o, i) { return [String(i), o]; }), f.stage) + '</select>') +
      fld('الحالة', '<select data-atd-f="status">' + opts(STATUS_OPTS, f.status) + '</select>') +
      '</div><div class="atd-pop__ft"><button type="button" class="atd-btn" data-atd-clear="all">مسح الكل</button><button type="button" class="atd-btn atd-btn--p" data-atd-pop="close">تم</button></div>';
  }

  function render(tickets, host) {
    var b = B(); if (!b) throw new Error('no bridge');
    S.last = tickets; head();
    var all = tickets.slice();
    S.base = all; chips(all);
    var list = all.filter(passes);
    var sel = list.filter(function (t) { return t.id === S.sel; })[0] || list[0] || null;
    S.sel = sel ? sel.id : null;
    host.classList.add('atd-host');
    if (!list.length) {
      sheet(false);
      host.innerHTML = '<div class="atd-card atd-empty"><b>لا توجد تذاكر مطابقة</b></div>';
      return;
    }
    var rows = list.map(function (t) {
      var on = t.id === S.sel, st = stageOf(t), sv = sevOf(t), no = b.shortTicketNum(t.ticket_number);
      return '<button type="button" class="atd-row" data-atd-pick="' + esc(t.id) + '" aria-pressed="' + on + '">' +
        '<span class="atd-row__main"><span class="atd-row__type">' + esc(t.violation_type) + (no ? ' <span class="atd-mono atd-no">#' + esc(no) + '</span>' : '') + '</span>' +
        '<span class="atd-mu">' + esc(t._empName) + ' · ' + esc(t._branchName) + ' · ' + esc(fdate(t)) + '</span></span>' +
        '<span class="atd-row__end"><span class="atd-sevdot atd-sevdot--' + sv[0] + '" title="الخطورة: ' + sv[1] + '">' + sv[1] + '</span>' +
        '<span class="atd-st atd-st--' + (TONE[st] || 'open') + '"><i></i>' + esc(SHORT[st]) + '</span></span></button>';
    }).join('');
    host.innerHTML = '<div class="atd-grid"><div class="atd-card atd-list">' + rows + '</div><aside class="atd-card atd-aside" id="atdAside" aria-label="تفاصيل التذكرة"></aside></div>';
    if (S.loading !== S.sel && (!b.state.editingTicket || b.state.editingTicket.id !== S.sel)) load(S.sel); else aside();
  }

  function load(id) {
    if (!id || typeof window.openTicket !== 'function') return aside();
    S.loading = id; S.silent = (S.silent || 0) + 1; window.__atdSilent = true; document.body.classList.add('atd-loading');
    var done = false;
    var fin = function () {
      if (done) return; done = true;
      S.silent = Math.max(0, (S.silent || 1) - 1); window.__atdSilent = S.silent > 0;
      try { window.closeModal('ticketModal'); } catch (_) {}
      setTimeout(function () { if (!S.loading || S.loading === id) document.body.classList.remove('atd-loading'); }, 450);
      if (S.loading === id) { S.loading = null; aside(); }
    };
    setTimeout(function () { if (!done) { fin(); if (S.loading === null || S.loading === id) document.body.classList.remove('atd-loading'); } }, 8000);
    Promise.resolve(window.openTicket(id)).then(fin, fin);
    aside();
  }

  function t12(h, m) { var ap = h >= 12 ? 'م' : 'ص'; return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + ap; }
  function dstr(d) { try { return d.toLocaleDateString('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return ''; } }
  function vtime(t) {
    var p = String(t.violation_time || '').split(':'), h = parseInt(p[0], 10), tm = isNaN(h) ? '' : t12(h, parseInt(p[1] || '0', 10) || 0);
    return esc(fdate(t) + (tm ? ' · ' + tm : ''));
  }
  function ctime(t) {
    var d = new Date(t.created_at); if (isNaN(d)) return '—';
    return esc(dstr(d) + ' · ' + t12(d.getHours(), d.getMinutes()));
  }
  function replies(t) {
    var b = B(), h = '';
    if (b.state.editingTicket && b.state.editingTicket.id === t.id) {
      var w = document.getElementById('logsWrap'); if (w && !w.querySelector('.fa-spinner')) h = w.innerHTML;
    }
    if (!h || !h.trim()) h = '<div class="atd-mu atd-nofile">لا توجد ردود أو سجل بعد</div>';
    return '<div class="atd-replies"><h3 class="atd-h3">الردود وسجل التذكرة</h3><div class="atd-logs">' + h + '</div></div>';
  }
  function truthy(v) { return v === true || v === 1 || v === 'true' || v === 't'; }
  function autoMark(t, i) {
    var code = i === 0 ? 'emp' : i === 1 ? 'sup' : ''; if (!code) return '';
    var on = truthy(t['auto_forwarded_' + code]);
    if (!on) {
      var logs = t.logs; if (typeof logs === 'string') { try { logs = JSON.parse(logs); } catch (_) { logs = []; } }
      if (Array.isArray(logs)) on = logs.some(function (l) {
        var a = String((l && l.action) || ''); if (!/تمرير تلقائي/.test(a)) return false;
        var toSup = /المشرف/.test(a); return code === 'emp' ? toSup : !toSup;
      });
    }
    return on ? ' <i class="fas fa-robot atd-auto" title="تم التمرير تلقائيًا" aria-label="تم التمرير تلقائيًا"></i>' : '';
  }
  function cdHtml(t, i) {
    var code = i === 0 ? 'emp' : i === 1 ? 'sup' : ''; if (!code) return '';
    if (code === 'sup') { var rl = ''; try { rl = String((B().state.currentUser || {}).role || ''); } catch (_) {} if (rl === 'employee' || rl === 'branch_manager') return ''; }
    var m = null; try { m = B().sla(t, code); } catch (_) {}
    if (!m && code === 'sup' && t.state === 'sup' && !truthy(t.auto_forwarded_sup)) {
      m = { limitH: 48, startISO: t._supStartTime || t.updated_at || t.created_at || '', deadlineISO: t.sup_forward_after || '' };
    }
    if (!m) return '';
    return '<div class="atd-cd" data-start="' + esc(m.startISO || '') + '" data-deadline="' + esc(m.deadlineISO || '') + '" data-limit="' + esc(m.limitH || 24) + '"><span class="atd-cd__l">متبقي</span><span class="atd-cd__v atd-mono" dir="ltr">--:--:--</span><span class="atd-cd__bar"><i></i></span></div>';
  }
  function tickCd() {
    var list = document.querySelectorAll('.atd-cd'); if (!list.length) return;
    list.forEach(function (c) {
      var lim = parseFloat(c.getAttribute('data-limit')) || 24, dl = new Date(c.getAttribute('data-deadline')).getTime(), st = new Date(c.getAttribute('data-start')).getTime();
      if (isNaN(dl)) { if (!isNaN(st)) dl = st + lim * 3600000; else return; }
      var rem = dl - Date.now(), v = c.querySelector('.atd-cd__v'), bar = c.querySelector('.atd-cd__bar i');
      if (rem <= 0) { v.textContent = '00:00:00'; c.classList.add('is-over'); c.classList.remove('is-warn'); if (bar) bar.style.width = '100%'; return; }
      var T = Math.floor(rem / 1000), h = Math.floor(T / 3600), mi = Math.floor(T % 3600 / 60), se = T % 60, p = function (n) { return String(n).padStart(2, '0'); };
      v.textContent = p(h) + ':' + p(mi) + ':' + p(se);
      var frac = rem / (lim * 3600000); c.classList.toggle('is-warn', frac <= 0.2); c.classList.remove('is-over');
      if (bar) bar.style.width = Math.min(100, Math.max(0, (1 - frac) * 100)) + '%';
    });
  }
  setInterval(tickCd, 1000);
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
    var sx = st >= 5 ? 4 : st;
    /* إلغاء/تنبيه: نحدد المرحلة التي توقفت عندها التذكرة ونعلّم نقطتها مثل علامة الروبوت */
    var stopIdx = -1, stopKind = '';
    if (st === 6 || st === 7) {
      stopKind = st === 6 ? 'warn' : 'cancel';
      var sc = ''; try { sc = b.stopStage(t, stopKind) || ''; } catch (_) {}
      stopIdx = Math.max(0, Math.min(3, ['emp', 'sup', 'mgt', 'aud'].indexOf(sc)));
      if (sc === 'hr') stopIdx = 3;
      if (!sc) stopIdx = 2;
      sx = stopIdx;
    }
    var steps = STEPS.map(function (n, i) {
      var isStop = stopIdx >= 0 && i === stopIdx;
      var after = stopIdx >= 0 && i > stopIdx;
      var done = stopIdx >= 0 ? i < stopIdx : i < sx, now = stopIdx >= 0 ? false : i === sx;
      if (i === 4 && st >= 5 && stopIdx < 0) n = NAMES[st];
      if (i === 4 && stopIdx >= 0) n = stopKind === 'warn' ? 'تنبيه إداري' : 'ملغاة';
      var sub = isStop
        ? '<span class="atd-stop atd-stop--' + stopKind + '"><i class="fas ' + (stopKind === 'warn' ? 'fa-bell' : 'fa-ban') + '" aria-hidden="true"></i>' + (stopKind === 'warn' ? 'تنبيه' : 'إلغاء') + '</span>'
        : done ? 'تم' + autoMark(t, i) : now ? (st >= 5 ? 'أُغلقت التذكرة' : 'بانتظار الإجراء') : '';
      return '<li class="atd-step' + (isStop ? ' is-stop' : '') + '"><div class="atd-step__rail"><i class="atd-dot ' + (isStop ? 'is-stop' : done ? 'is-done' : now ? 'is-now' : '') + '"></i><i class="atd-line' + (done ? ' is-done' : '') + '"></i></div><div class="atd-step__t"><div class="' + (now || isStop ? 'is-now' : done ? '' : 'is-off') + '">' + esc(n) + '</div><div class="atd-stl"><div class="atd-mu">' + sub + '</div>' + (now ? cdHtml(t, i) : '') + '</div></div></li>';
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
      '<div class="atd-sbar"><button type="button" class="atd-back" data-atd-back="1"><i class="fas fa-arrow-right" aria-hidden="true"></i><span>رجوع للقائمة</span></button><button type="button" class="atd-pdf2" data-atd-pdf="1" aria-label="تصدير PDF"><i class="fas fa-file-pdf" aria-hidden="true"></i><span>PDF</span></button></div><div class="atd-a-head"><button type="button" class="atd-pdf" data-atd-pdf="1" aria-label="تصدير تقرير المخالفة PDF"><i class="fas fa-file-pdf" aria-hidden="true"></i><span>PDF</span></button><span class="atd-mono atd-kk">TICKET #' + esc(b.shortTicketNum(t.ticket_number)) + '</span><h2 class="atd-h2">' + esc(t.violation_type) + '</h2><div class="atd-a-meta">' + sevChip(sv) + '<span class="atd-mu">' + esc(fdate(t)) + '</span></div></div>' +
      '<div class="atd-info"><div><div class="atd-mu">الموظف</div><div class="atd-v">' + esc(t._empName) + '</div></div><div><div class="atd-mu">الفرع</div><div class="atd-v">' + esc(t._branchName) + '</div></div>' +
      (b.hideObs() ? '' : '<div><div class="atd-mu">الراصد</div><div class="atd-v">' + esc(t._obsName || '-') + '</div></div>') +
      '<div><div class="atd-mu">وقت المخالفة</div><div class="atd-v">' + vtime(t) + '</div></div><div><div class="atd-mu">وقت الرصد</div><div class="atd-v">' + ctime(t) + '</div></div><div><div class="atd-mu">المرحلة الحالية</div><div class="atd-v">' + esc(NAMES[st]) + '</div></div></div>' +
      '<p class="atd-desc">' + esc(t.description || '—') + '</p>' +
      '<div><h3 class="atd-h3">المرفقات</h3>' + (files || '<div class="atd-mu atd-nofile">لا توجد مرفقات</div>') + '</div>' +
      '<ol class="atd-steps" aria-label="مسار التذكرة">' + steps + '</ol>' + replies(t) + act;
    tickCd();
    if (S.pendingScroll) { S.pendingScroll = false; setTimeout(function () { try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, 150); }
  }

  function sheet(on) {
    var mob = document.documentElement.classList.contains('mr-mobile-ui');
    var o = !!(on && mob);
    document.body.classList.toggle('atd-sheet-open', o); document.documentElement.classList.toggle('atd-sheet-open', o);
    if (on && mob) { var a = document.getElementById('atdAside'); if (a) a.scrollTop = 0; }
  }
  setInterval(function () {
    if (!document.documentElement.classList.contains('atd-sheet-open')) return;
    var tab = document.getElementById('tab-workflow');
    if (!tab || !tab.classList.contains('active')) sheet(false);
  }, 400);
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-atd-clear],[data-atd-pop],#atdFilterBtn,[data-atd-pick],[data-atd-view],[data-atd-act],[data-atd-pdf],[data-atd-back]'); if (!t) return;
    var b = B(); if (!b) return;
    if (t.id === 'atdFilterBtn') { var pp = document.getElementById('atdFilterPop'); pp.hidden = !pp.hidden; if (!pp.hidden) fillPop(S.base || []); }
    else if (t.hasAttribute('data-atd-pop')) { document.getElementById('atdFilterPop').hidden = true; }
    else if (t.hasAttribute('data-atd-clear')) {
      var k = t.getAttribute('data-atd-clear');
      if (k === 'all') S.f = { branch: '', emp: '', stage: '', status: '', from: '', to: '' };
      else if (k === 'period') { S.f.from = ''; S.f.to = ''; } else S.f[k] = '';
      syncDates(); S.sel = null; b.refilter(); if (!document.getElementById('atdFilterPop').hidden) fillPop(S.base || []);
    }
    else if (t.hasAttribute('data-atd-back')) { sheet(false); }
    else if (t.hasAttribute('data-atd-pick')) { S.sel = t.getAttribute('data-atd-pick'); b.refilter(); sheet(true); }
    else if (t.hasAttribute('data-atd-pdf')) {
      var tk = (b.state.violations || []).filter(function (v) { return v.id === S.sel; })[0];
      if (tk) { b.state.editingTicket = tk; if (typeof window.printTicketDetail === 'function') window.printTicketDetail(); }
    }
    else if (t.hasAttribute('data-atd-view')) { if (typeof window.openAttViewerByIndex === 'function') window.openAttViewerByIndex(+t.getAttribute('data-atd-view')); }
    else if (t.hasAttribute('data-atd-act')) {
      var ta = document.getElementById('atdResp'), real = document.getElementById('respText');
      if (real && ta) real.value = ta.value;
      var r = document.querySelectorAll('#responseButtons .td-resp-action')[+t.getAttribute('data-atd-act')];
      if (r) r.click();
    }
  });
  function syncDates() { var b = B(); if (b && b.setDateRange) b.setDateRange(S.f.from, S.f.to); }
  document.addEventListener('change', function (e) {
    var k = e.target && e.target.getAttribute && e.target.getAttribute('data-atd-f'); if (!k) return;
    S.f[k] = e.target.value; S.sel = null; sheet(false);
    if (k === 'from' || k === 'to') { if (S.f.from && S.f.to) { if (S.f.from > S.f.to) { var x = S.f.from; S.f.from = S.f.to; S.f.to = x; } syncDates(); return; } if (!S.f.from && !S.f.to) syncDates(); }
    B().refilter();
  });
  document.addEventListener('mousedown', function (e) {
    var p = document.getElementById('atdFilterPop'); if (!p || p.hidden) return;
    if (!p.contains(e.target) && !(e.target.closest && e.target.closest('#atdFilterBtn'))) p.hidden = true;
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'atdResp') { S.resp[S.sel] = e.target.value; var r = document.getElementById('respText'); if (r) r.value = e.target.value; }
  });
  function selectTicket(id) {
    var b = B(); if (!b) return false;
    S.sel = id; S.pendingScroll = false; sheet(true); S.f = { branch: '', emp: '', stage: '', status: '', from: S.f.from, to: S.f.to };
    var tab = document.getElementById('tab-workflow');
    if (tab && tab.classList.contains('active')) b.refilter(); else b.goWorkflow();
    return true;
  }
  window.AtharTicketsDesign = { select: selectTicket, render: render, sevOf: sevOf, fdate: fdate, esc: esc };
})();
