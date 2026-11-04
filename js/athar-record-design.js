/* Record-violation page — desktop + mobile design (O_Record): header + "آخر ما رصدته" card. */
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
    if (!tab.dataset.atrLbl) {
      tab.dataset.atrLbl = '1';
      var set = function (sel, txt) { var l = tab.querySelector(sel); if (l) l.textContent = txt; };
      set('label[for="nt-empSearch"]', 'الموظف'); set('label[for="nt-typeSearch"]', 'نوع المخالفة');
      set('label[for="nt-dateBtn"]', 'تاريخ الواقعة'); set('label[for="nt-timeBtn"]', 'الوقت'); set('label[for="nt-desc"]', 'تفاصيل الواقعة');
      var ta = document.getElementById('nt-desc'); if (ta) { ta.rows = 4; ta.placeholder = 'اكتب ما حدث باختصار'; }
      var ft = tab.querySelector('.mk-form-ft');
      if (ft && !document.getElementById('atrAttach')) {
        var a = document.createElement('button'); a.type = 'button'; a.id = 'atrAttach'; a.className = 'mk-btn'; a.textContent = 'إرفاق ملف';
        a.onclick = function () { var f = document.getElementById('nt-files'); if (f) f.click(); };
        ft.appendChild(a);
      }
    }
    var me = b.state.currentUser; if (!me) return;
    var aside = document.getElementById('atdRecent');
    if (!aside) { aside = document.createElement('aside'); aside.id = 'atdRecent'; aside.className = 'atr-recent'; panel.appendChild(aside); }
    var mine = (b.state.violations || []).filter(function (v) { return v && String(v.observer_id) === String(me.id); })
      .sort(function (x, y) { return new Date(y.created_at) - new Date(x.created_at); }).slice(0, 6);
    function nm(v) { if (v._empName && v._empName !== '-') return v._empName; var u = (b.state.users || []).filter(function (x) { return String(x.id) === String(v.employee_id); })[0]; return u ? u.name : '—'; }
    function rng() { try { var f = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { month: 'long' }), n = new Date(), p = new Date(n.getFullYear(), n.getMonth() - 1, 1); return f.format(p) + ' - ' + f.format(n) + ' ' + n.getFullYear(); } catch (_) { return ''; } }
    var html = '<div class="atr-rh"><h2>آخر ما رصدته</h2><p>' + rng() + '</p></div>' + (mine.length ? mine.map(function (v) {
      var sv = T.sevOf(v);
      return '<div class="atr-rrow"><div><div class="atr-rn">' + esc(nm(v)) + '</div><div class="atd-mu">' + esc(v.violation_type) + ' · ' + esc(T.fdate(v)) + '</div></div><span class="atd-sev atd-sev--' + sv[0] + '">' + sv[1] + '</span></div>';
    }).join('') : '<div class="atd-mu atr-none">لم ترصد أي مخالفة بعد</div>');
    if (aside.dataset.h !== html) { aside.dataset.h = html; aside.innerHTML = html; }
  }
  /* Picked employee / type lives inside the field: banner replaces the search box, with a "تغيير" button. */
  function pickFields() {
    ['emp', 'type'].forEach(function (k) {
      var slot = document.getElementById('nt-' + k + 'Found'); if (!slot) return;
      var field = slot.closest('.mk-field'); if (!field) return;
      var ban = slot.querySelector('.mk-pick-banner');
      var key = ban ? (ban.querySelector('strong') || ban).textContent : '';
      if (field.dataset.atrPick !== key) { field.dataset.atrPick = key; field.classList.remove('atr-editing'); }
      if (ban && !ban.querySelector('.atr-change')) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'atr-change'; b.textContent = 'تغيير';
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); field.classList.add('atr-editing'); var i = field.querySelector('.figma-search-input'); if (i) i.focus(); };
        ban.appendChild(b);
      }
      field.classList.toggle('atr-picked', !!ban && slot.style.display !== 'none');
    });
  }
  setInterval(pickFields, 250);
  document.addEventListener('click', function (e) {
    document.querySelectorAll('#tab-newTicket .mk-field.atr-editing').forEach(function (f) {
      if (f.contains(e.target)) return;
      if (f.dataset.atrPick) f.classList.remove('atr-editing');
    });
  });
  setInterval(mount, 1200);
})();
