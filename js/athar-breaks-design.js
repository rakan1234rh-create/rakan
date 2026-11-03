/* Breaks page — desktop design (E_Breaks): current break card, start-new card, my sessions table. */
(function () {
  'use strict';
  function tm(iso) { if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return '—'; return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function dur(r) {
    var a = new Date(r.started_at), z = r.ended_at ? new Date(r.ended_at) : new Date();
    if (isNaN(a)) return '—'; var s = Math.max(0, Math.round((z - a) / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function day(iso) {
    var d = new Date(iso); if (isNaN(d)) return '—';
    var t = new Date(); var same = d.toDateString() === t.toDateString();
    return same ? 'اليوم' : (new Date(t - 864e5).toDateString() === d.toDateString() ? 'أمس' : d.toLocaleDateString('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }));
  }
  function html(c) {
    var e = c.esc;
    var head = '<header class="atb-hd"><div><p class="atd-kick">EMPLOYEE BREAKS</p><h1 class="atd-h1">بريكاتي</h1></div></header>';
    var cur;
    if (c.active) {
      var over = c.remaining < 0, pct = c.planned ? Math.max(0, Math.min(100, (c.remaining / (c.planned * 60)) * 100)) : 0;
      cur = '<div class="atb-card atb-cur" id="rdBreaksRingHost" data-break-kind="' + (over ? 'overage' : 'active') + '"><div class="atb-row"><h2>البريك الجاري</h2><span class="atb-imu">' + e(c.typeLabel) + '</span></div>' +
        '<div class="atb-timerline"><span class="atb-timer" data-break-clock dir="ltr">' + e(over ? c.overClock(c.remaining) : c.clock(c.remaining)) + '</span><span class="atb-imu">من <span class="atd-mono atb-imu">' + e(String(c.planned).padStart(2, '0') + ':00') + '</span> دقيقة</span></div>' +
        '<div class="atb-trk" aria-hidden="true"><div class="atb-bar" style="width:' + (over ? 100 : pct) + '%"></div></div>' +
        (c.busy ? '<button type="button" class="atb-end" disabled>جاري الإيقاف…</button>' : '<button type="button" class="atb-end" onclick="endStaffBreakFromUi()">إنهاء البريك</button>') +
        '<p class="atb-imu atb-since">بدأ الساعة <span class="atd-mono atb-imu">' + e(tm(c.active.started_at)) + '</span></p></div>';
    } else {
      cur = '<div class="atb-card atb-cur" id="rdBreaksRingHost" data-break-kind="ready"><div class="atb-row"><h2>البريك الجاري</h2></div><div class="atb-none"><span class="atb-imu">لا يوجد بريك جارٍ حالياً</span></div></div>';
    }
    var can = function (t) { return !t.exhausted && !t.unscheduled && t.mins > 0; };
    var anyOk = can(c.regular) || can(c.restroom) && !c.colleague;
    var note = c.colleague ? 'زميل في بريك الآن (' + c.colleague + ') — انتظر حتى يعود'
      : (!can(c.regular) && !can(c.restroom) ? [['البريك', c.regular], ['بريك دورة المياه', c.restroom]].map(function (x) { return x[1].exhausted ? 'خلصت مدة ' + x[0] + ' اليوم' : (x[1].unscheduled ? (x[1].note || x[0] + ' غير مجدول اليوم') : x[0] + ' غير متاح اليوم'); }).join(' · ') : '');
    var dis = (c.busy || c.active || c.colleague || !anyOk) ? ' disabled' : '';
    var start = '<div class="atb-card atb-new"><h2>بدء بريك جديد</h2><div class="atb-form"><div class="atb-f"><label for="atbType">نوع البريك</label>' +
      '<select id="atbType"' + (c.active ? ' disabled' : '') + '><option value="regular"' + (can(c.regular) ? '' : ' disabled') + '>استراحة</option><option value="restroom"' + (can(c.restroom) ? '' : ' disabled') + '>دورة مياه</option></select></div>' +
      '<button type="button" class="atb-go"' + dis + ' onclick="startStaffBreakFromUi(document.getElementById(\'atbType\').value)">بدء البريك</button></div>' +
      (note && !c.active ? '<p class="atb-note">' + e(note) + '</p>' : '') +
      '<div class="atb-lim"><h3>المدد المسموحة لفرعك</h3><div class="atb-limrow">' +
      '<span><span class="atb-mu2">استراحة</span> <b class="atd-mono">' + (c.regular.mins || '—') + ' د</b></span>' +
      '<span><span class="atb-mu2">دورة مياه</span> <b class="atd-mono">' + (c.restroom.mins || '—') + ' د</b></span>' +
      '<span><span class="atb-mu2">النطاق</span> <b>' + e(c.branch) + '</b></span></div></div></div>';
    var stat = function (r) {
      if (r.status === 'active') return 'جارٍ';
      if (Number(r.overtime_seconds) > 0) return 'تجاوز';
      if (r.status === 'paused') return 'متوقف';
      return 'انتهى';
    };
    var body = c.rows.length ? c.rows.map(function (r) {
      return '<tr><td>' + e(day(r.started_at)) + '</td><td>' + e(r.break_type === 'restroom' ? 'دورة مياه' : 'استراحة') + '</td><td class="atd-mono atb-c">' + tm(r.started_at) + '</td><td class="atd-mono atb-c">' + (r.ended_at ? tm(r.ended_at) : '—') + '</td><td class="atd-mono atb-c">' + dur(r) + '</td><td><b>' + stat(r) + '</b></td></tr>';
    }).join('') : '<tr><td colspan="6" class="atb-empty">لا توجد جلسات اليوم</td></tr>';
    var log = '<section class="atb-card atb-log"><div class="atb-row"><h2>سجل جلساتي</h2><span class="atb-mu">اليوم</span></div><div class="atb-scroll"><table><thead><tr><th>اليوم</th><th>النوع</th><th>البداية</th><th>النهاية</th><th>المدة</th><th>الحالة</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
    return head + '<section class="atb-top">' + cur + start + '</section>' + log;
  }
  /* ── Manager monitor: only employees who took a break today; sessions expand inline ── */
  var OPEN = {};
  function monitor(m) {
    var e = m.esc;
    var chipDefs = [['all', 'الكل'], ['active', 'في البريك الآن'], ['paused', 'متوقف'], ['overage', 'تجاوز المدة'], ['ended', 'انتهى']];
    var chips = chipDefs.map(function (c) {
      return '<button type="button" class="abm-chip' + (m.filter === c[0] ? ' is-on' : '') + '" onclick="setBreakStatusFilter(\'' + c[0] + '\')"><span>' + c[1] + '</span><b>' + (m.counts[c[0]] || 0) + '</b></button>';
    }).join('');
    var tool = '<div class="abm-tool"><div class="abm-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="search" id="rdBreaksSearch" value="' + e(m.q) + '" placeholder="بحث بالاسم أو الرقم الوظيفي أو الفرع" autocomplete="off" oninput="refreshBreaksFromSearch(this)" aria-label="بحث"></div>' +
      '<div class="abm-chips" role="group" aria-label="تصفية الحالة">' + chips + '</div></div>';
    var rows = m.rows.map(function (r) {
      var open = !!OPEN[r.id] && m.canHist;
      var live = r.kind === 'active' || r.kind === 'overage';
      var attrs = r.liveId ? ' data-break-live-row="' + e(r.liveId) + '" data-break-live-status="active"' : '';
      var sess = open ? '<div class="abm-sess"><table><thead><tr><th>#</th><th>النوع</th><th>من</th><th>إلى</th><th>المدة</th><th>الحالة</th></tr></thead><tbody>' + r.sessions.map(function (s) {
        return '<tr class="' + s.tone + '"><td class="atd-mono">' + s.n + '</td><td>' + e(s.type) + '</td><td class="atd-mono">' + e(s.from) + '</td><td class="atd-mono">' + e(s.to) + '</td><td class="atd-mono">' + e(s.dur) + '</td><td><span class="abm-st abm-st--' + s.tone + '">' + e(s.status) + '</span>' + (s.reason ? '<div class="abm-reason">السبب: ' + e(s.reason) + '</div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '';
      return '<article class="abm-row' + (open ? ' is-open' : '') + '"' + attrs + '>' +
        '<div class="abm-main"><div class="abm-av" aria-hidden="true">' + e(r.initial) + '</div><div class="abm-who"><div class="abm-name">' + e(r.name) + (r.me ? ' <span class="abm-me">أنت</span>' : '') + '</div><div class="abm-sub">' + e(r.branch) + (r.num ? ' · <span class="atd-mono">' + e(r.num) + '</span>' : '') + '</div></div>' +
        '<span class="abm-tag abm-tag--' + r.kind + '"' + (live ? ' data-break-row-status' : '') + '><i></i>' + e(r.statusLbl) + '</span>' +
        '<div class="abm-meta"><span class="abm-mu">الجلسات</span><b class="atd-mono">' + r.sessions.length + '</b></div>' +
        '<div class="abm-meta"><span class="abm-mu">' + (live ? 'المتبقي' : 'المستخدم') + '</span><b class="atd-mono abm-clock' + (r.kind === 'overage' ? ' is-over' : '') + '"' + (r.liveId ? ' data-break-row-clock="' + e(r.liveId) + '"' : '') + ' dir="ltr">' + e(r.clock) + '</b></div>' +
        (r.force ? '<button type="button" class="abm-btn" data-break-admin-force="' + e(r.liveId) + '" ' + (r.kind === 'overage' ? '' : 'hidden') + ' onclick="event.stopPropagation();adminForceEndStaffBreakFromUi(\'' + e(r.liveId) + '\')">إيقاف</button>' : '') +
        (m.canHist ? '<button type="button" class="abm-btn abm-btn--g" data-abm-toggle="' + e(r.id) + '" aria-expanded="' + open + '">' + (open ? 'إخفاء الجلسات' : 'عرض الجلسات') + '</button>' : '') +
        '</div>' + sess + '</article>';
    }).join('');
    var list = rows ? '<div class="abm-list">' + rows + '</div>' : '<div class="abm-empty">' + (m.q ? 'لا توجد نتائج مطابقة' : 'لا يوجد موظف أخذ بريكاً اليوم') + '</div>';
    return '<section class="abm" aria-label="مراقبة البريكات">' + tool + list + '</section>';
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-abm-toggle]'); if (!t) return;
    var id = t.getAttribute('data-abm-toggle'); OPEN[id] = !OPEN[id];
    if (typeof window.renderStaffBreaksPage === 'function') window.renderStaffBreaksPage({ soft: true });
  });
  window.AtharBreaksDesign = { html: html, monitor: monitor };
})();
