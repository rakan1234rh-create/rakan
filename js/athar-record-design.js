/* Record-violation page — desktop design (O_Record): header + "آخر ما رصدته" card. */
(function () {
  'use strict';
  function ready() { return window.__atdBridge && window.AtharTicketsDesign; }
  function mount() {
    if (!ready()) return;
    var tab = document.getElementById('tab-newTicket'); if (!tab || tab.hidden || !tab.offsetParent) return;
    var b = window.__atdBridge, T = window.AtharTicketsDesign, esc = T.esc;
    var panel = tab.querySelector('.mk-form-panel'); if (!panel) return;
    if (!document.getElementById('atdRecHead')) {
      var h = document.createElement('div'); h.id = 'atdRecHead'; h.className = 'atr-head';
      h.innerHTML = '<p class="atd-kick">RECORD VIOLATION</p><h1 class="atd-h1">رصد مخالفة</h1>';
      tab.querySelector('.panel').insertBefore(h, panel);
      var card = panel.querySelector('.rd-nt-form-card'), grid = panel.querySelector('.mk-form-grid');
      if (card && grid) { var t = document.createElement('h2'); t.className = 'atr-ttl'; t.textContent = 'بيانات المخالفة'; card.insertBefore(t, grid); }
    }
    var me = b.state.currentUser; if (!me) return;
    var aside = document.getElementById('atdRecent');
    if (!aside) { aside = document.createElement('aside'); aside.id = 'atdRecent'; aside.className = 'atr-recent'; panel.appendChild(aside); }
    var mine = (b.state.violations || []).filter(function (v) { return v && String(v.observer_id) === String(me.id); })
      .sort(function (x, y) { return new Date(y.created_at) - new Date(x.created_at); }).slice(0, 6);
    function nm(v) { if (v._empName && v._empName !== '-') return v._empName; var u = (b.state.users || []).filter(function (x) { return String(x.id) === String(v.employee_id); })[0]; return u ? u.name : '—'; }
    var html = '<div class="atr-rh"><h2>آخر ما رصدته</h2></div>' + (mine.length ? mine.map(function (v) {
      var sv = T.sevOf(v);
      return '<div class="atr-rrow"><div><div class="atr-rn">' + esc(nm(v)) + '</div><div class="atd-mu">' + esc(v.violation_type) + ' · ' + esc(T.fdate(v)) + '</div></div><span class="atd-sev atd-sev--' + sv[0] + '">' + sv[1] + '</span></div>';
    }).join('') : '<div class="atd-mu atr-none">لم ترصد أي مخالفة بعد</div>');
    if (aside.dataset.h !== html) { aside.dataset.h = html; aside.innerHTML = html; }
  }
  setInterval(mount, 1200);
})();
