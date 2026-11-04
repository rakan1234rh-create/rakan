/* ATHAR — unified dropdown (with search) + date picker.
   Upgrades native <select> and <input type="date"> in place: the native element stays the
   source of truth (value / change events / inline handlers keep working). */
(function () {
  'use strict';
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['أ', 'إ', 'ث', 'ر', 'خ', 'ج', 'س'];
  var SEARCH_MIN = 7;
  var Z = 2147483000;
  var current = null; // { close(), owner }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').trim();
  }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function isMobile() { return window.matchMedia && window.matchMedia('(max-width:640px)').matches; }
  function closeCurrent() { if (current) { var c = current; current = null; try { c.close(); } catch (_) { /* noop */ } } }

  function place(pop, anchor, wMin) {
    var r = anchor.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    if (isMobile()) { pop.classList.add('is-sheet'); pop.style.cssText = ''; pop.style.zIndex = String(Z); return; }
    pop.classList.remove('is-sheet');
    var w = Math.max(r.width, wMin || 200);
    w = Math.min(w, vw - 16);
    pop.style.width = w + 'px';
    var ph = pop.offsetHeight || 280;
    var below = vh - r.bottom - 8, above = r.top - 8;
    var top = (below >= Math.min(ph, 280) || below >= above) ? r.bottom + 6 : Math.max(8, r.top - ph - 6);
    var maxH = Math.max(160, (top > r.top ? below : above) - 4);
    pop.style.maxHeight = Math.min(360, maxH) + 'px';
    var left = r.right - w; /* RTL: align to the right edge of the control */
    if (document.documentElement.dir !== 'rtl' && getComputedStyle(anchor).direction !== 'rtl') left = r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function mountPopup(pop, anchor, onClose, wMin) {
    closeCurrent();
    var back = null;
    document.body.appendChild(pop);
    if (isMobile()) { back = el('div', 'as-back'); back.style.zIndex = String(Z - 1); document.body.appendChild(back); }
    pop.style.zIndex = String(Z);
    place(pop, anchor, wMin);
    requestAnimationFrame(function () { pop.classList.add('is-in'); if (back) back.classList.add('is-in'); place(pop, anchor, wMin); });
    var onDoc = function (e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeCurrent(); };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeCurrent(); try { anchor.focus(); } catch (_) { /* noop */ } } };
    var onScroll = function (e) { if (pop.contains(e.target)) return; if (!isMobile()) closeCurrent(); };
    setTimeout(function () {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('touchstart', onDoc, true);
    }, 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeCurrent);
    if (back) back.addEventListener('click', closeCurrent);
    current = {
      owner: anchor,
      close: function () {
        document.removeEventListener('mousedown', onDoc, true);
        document.removeEventListener('touchstart', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', closeCurrent);
        pop.remove(); if (back) back.remove();
        anchor.setAttribute('aria-expanded', 'false');
        if (onClose) onClose();
      }
    };
    anchor.setAttribute('aria-expanded', 'true');
  }

  /* ───────────────────────── select ───────────────────────── */
  function labelOf(sel) {
    if (sel.id) { var l = document.querySelector('label[for="' + sel.id + '"]'); if (l) return l.textContent.replace(/[*\s]+$/, '').trim(); }
    return sel.getAttribute('aria-label') || '';
  }

  function enhanceSelect(sel) {
    if (sel.__as) return;
    sel.__as = true;
    var wrap = el('div', 'as');
    var btn = el('button', 'as-btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var lbl = labelOf(sel); if (lbl) btn.setAttribute('aria-label', lbl);
    btn.innerHTML = '<span class="as-val"></span><svg class="as-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    sel.classList.add('as-native');
    sel.tabIndex = -1;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(sel);
    sel.__asBtn = btn;

    function sync() {
      var o = sel.options[sel.selectedIndex];
      var v = btn.querySelector('.as-val');
      v.textContent = o ? o.text : '';
      var ph = !o || o.value === '' || sel.value === '';
      btn.classList.toggle('is-ph', ph);
      btn.classList.toggle('is-set', sel.selectedIndex > 0);
      btn.disabled = sel.disabled;
      wrap.classList.toggle('is-disabled', sel.disabled);
      if (sel.classList.contains('is-invalid') || sel.getAttribute('aria-invalid') === 'true') btn.classList.add('is-invalid'); else btn.classList.remove('is-invalid');
    }
    sel.__asSync = sync;
    sync();
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'aria-invalid'] });
    sel.addEventListener('change', sync);
    var lab = sel.id ? document.querySelector('label[for="' + sel.id + '"]') : null;
    if (lab) lab.addEventListener('click', function (e) { e.preventDefault(); btn.focus(); });

    btn.addEventListener('click', function () { if (current && current.owner === btn) { closeCurrent(); return; } openSelect(sel, btn); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openSelect(sel, btn); }
    });
  }

  function openSelect(sel, btn) {
    var opts = [];
    Array.prototype.forEach.call(sel.children, function (c) {
      if (c.tagName === 'OPTGROUP') {
        opts.push({ group: c.label });
        Array.prototype.forEach.call(c.children, function (o) { opts.push({ o: o }); });
      } else if (c.tagName === 'OPTION') opts.push({ o: c });
    });
    var real = opts.filter(function (x) { return x.o; });
    var searchable = real.length >= SEARCH_MIN;
    var pop = el('div', 'as-pop');
    pop.setAttribute('role', 'dialog');
    var title = labelOf(sel);
    if (isMobile()) pop.appendChild(el('div', 'as-sheet-hd', '<span>' + esc(title || 'اختيار') + '</span>'));
    var input = null;
    if (searchable) {
      var sw = el('div', 'as-search');
      sw.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13.5 13.5 17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      input = el('input'); input.type = 'text'; input.placeholder = 'ابحث…'; input.setAttribute('aria-label', 'بحث'); input.autocomplete = 'off';
      sw.appendChild(input); pop.appendChild(sw);
    }
    var list = el('div', 'as-list'); list.setAttribute('role', 'listbox');
    pop.appendChild(list);
    var empty = el('div', 'as-empty', 'لا توجد نتائج'); empty.hidden = true; pop.appendChild(empty);

    var rows = [];
    opts.forEach(function (x) {
      if (x.group != null) { var g = el('div', 'as-grp', esc(x.group)); list.appendChild(g); rows.push({ g: g }); return; }
      var o = x.o;
      var b = el('button', 'as-opt' + (o.selected ? ' is-sel' : '') + (o.value === '' ? ' is-ph' : ''));
      b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', o.selected ? 'true' : 'false');
      if (o.disabled) b.disabled = true;
      b.innerHTML = '<span class="as-opt-t">' + esc(o.text) + '</span><svg class="as-tick" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="m2.5 7.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      b.addEventListener('click', function () {
        if (o.disabled) return;
        sel.value = o.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (sel.__asSync) sel.__asSync();
        closeCurrent();
        try { btn.focus(); } catch (_) { /* noop */ }
      });
      list.appendChild(b);
      rows.push({ b: b, k: norm(o.text), o: o });
    });

    var act = -1;
    function visible() { return rows.filter(function (r) { return r.b && !r.b.hidden && !r.o.disabled; }); }
    function setAct(i) {
      var v = visible(); if (!v.length) return;
      act = Math.max(0, Math.min(v.length - 1, i));
      rows.forEach(function (r) { if (r.b) r.b.classList.remove('is-act'); });
      v[act].b.classList.add('is-act');
      v[act].b.scrollIntoView({ block: 'nearest' });
    }
    function filter() {
      var q = norm(input ? input.value : '');
      var any = false;
      rows.forEach(function (r) { if (r.b) { var show = !q || r.k.indexOf(q) >= 0; r.b.hidden = !show; if (show) any = true; } });
      rows.forEach(function (r, i) { if (r.g) { var next = rows.slice(i + 1).findIndex(function (z) { return z.g; }); var seg = rows.slice(i + 1, next < 0 ? undefined : i + 1 + next); r.g.hidden = !seg.some(function (z) { return z.b && !z.b.hidden; }); } });
      empty.hidden = any;
      setAct(0);
    }
    pop.addEventListener('keydown', function (e) {
      var v = visible();
      if (e.key === 'ArrowDown') { e.preventDefault(); setAct(act + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(act - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (v[act]) v[act].b.click(); }
    });
    if (input) input.addEventListener('input', filter);

    mountPopup(pop, btn, null, 220);
    var selIdx = rows.findIndex(function (r) { return r.o && r.o.selected; });
    if (input && !isMobile()) input.focus({ preventScroll: true });
    else { var sb = pop.querySelector('.as-opt.is-sel'); if (sb) sb.focus({ preventScroll: true }); }
    setTimeout(function () {
      var sb = pop.querySelector('.as-opt.is-sel');
      if (sb) sb.scrollIntoView({ block: 'center' });
      var v = visible(); var i = v.findIndex(function (r) { return r.o.selected; });
      setAct(i < 0 ? 0 : i);
    }, 30);
    void selIdx;
  }

  /* patch programmatic value changes so the visible button stays in sync */
  (function patch() {
    ['value', 'selectedIndex'].forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, k);
      if (!d || !d.set) return;
      Object.defineProperty(HTMLSelectElement.prototype, k, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) { d.set.call(this, v); if (this.__asSync) this.__asSync(); }
      });
    });
  })();

  /* ───────────────────────── date ───────────────────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parseIso(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; }
  function todayParts() {
    try { if (typeof ksaTodayCalendar === 'function') { var t = ksaTodayCalendar(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; } } catch (_) { /* noop */ }
    var n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
  }
  function fmt(s) { var p = parseIso(s); return p ? p.d + ' ' + MONTHS[p.m] + ' ' + p.y : ''; }

  function openCalendar(anchor, o) {
    var cur = parseIso(o.value) || todayParts();
    var view = { y: cur.y, m: cur.m, mode: 'days' };
    var tp = todayParts();
    var pop = el('div', 'as-pop ad-pop');
    pop.setAttribute('role', 'dialog');
    function bound(s) { return s ? parseIso(s) : null; }
    function cmp(a, b) { return a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d; }
    function draw() {
      var min = bound(o.min), max = bound(o.max), sel = parseIso(o.value);
      var h = '<div class="ad-hd"><button type="button" class="ad-title" data-a="mode">' +
        (view.mode === 'days' ? esc(MONTHS[view.m]) + ' ' + view.y : view.y) +
        '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<div class="ad-nav"><button type="button" class="ad-nb" data-a="next" aria-label="التالي"><svg viewBox="0 0 12 12" width="12" height="12"><path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button type="button" class="ad-nb" data-a="prev" aria-label="السابق"><svg viewBox="0 0 12 12" width="12" height="12"><path d="M4.5 2.5 8 6 4.5 9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>';
      if (view.mode === 'months') {
        h += '<div class="ad-months">' + MONTHS.map(function (n, i) { return '<button type="button" class="ad-m' + (i === view.m ? ' is-sel' : '') + '" data-m="' + i + '">' + n + '</button>'; }).join('') + '</div>';
      } else {
        h += '<div class="ad-wd">' + DAYS.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="ad-days">';
        var first = new Date(view.y, view.m, 1).getDay();
        var dim = new Date(view.y, view.m + 1, 0).getDate();
        for (var i = 0; i < first; i++) h += '<span class="ad-e"></span>';
        for (var d = 1; d <= dim; d++) {
          var p = { y: view.y, m: view.m, d: d };
          var dis = (min && cmp(p, min) < 0) || (max && cmp(p, max) > 0);
          var cls = 'ad-d' + (sel && cmp(p, sel) === 0 ? ' is-sel' : '') + (cmp(p, tp) === 0 ? ' is-today' : '');
          h += '<button type="button" class="' + cls + '" data-d="' + d + '"' + (dis ? ' disabled' : '') + '>' + d + '</button>';
        }
        h += '</div>';
      }
      h += '<div class="ad-ft"><button type="button" class="ad-fb" data-a="today">اليوم</button>' + (o.clearable === false ? '' : '<button type="button" class="ad-fb" data-a="clear">مسح</button>') + '</div>';
      pop.innerHTML = h;
    }
    pop.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var a = t.getAttribute('data-a');
      if (a === 'mode') { view.mode = view.mode === 'days' ? 'months' : 'days'; draw(); return; }
      if (a === 'next' || a === 'prev') {
        var s = a === 'next' ? 1 : -1;
        if (view.mode === 'months') view.y += s; else { view.m += s; if (view.m > 11) { view.m = 0; view.y++; } if (view.m < 0) { view.m = 11; view.y--; } }
        draw(); return;
      }
      if (a === 'today') { o.onPick(iso(tp.y, tp.m, tp.d)); closeCurrent(); return; }
      if (a === 'clear') { o.onPick(''); closeCurrent(); return; }
      if (t.hasAttribute('data-m')) { view.m = +t.getAttribute('data-m'); view.mode = 'days'; draw(); return; }
      if (t.hasAttribute('data-d')) { o.onPick(iso(view.y, view.m, +t.getAttribute('data-d'))); closeCurrent(); }
    });
    draw();
    mountPopup(pop, anchor, null, 296);
  }

  function enhanceDate(inp) {
    if (inp.__ad) return;
    inp.__ad = true;
    var wrap = el('div', 'as ad');
    var btn = el('button', 'as-btn ad-btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    var lbl = labelOf(inp); if (lbl) btn.setAttribute('aria-label', lbl);
    btn.innerHTML = '<svg class="ad-ico" viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="as-val"></span>';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(btn); wrap.appendChild(inp);
    inp.classList.add('as-native');
    try { inp.type = 'text'; inp.readOnly = true; } catch (_) { /* noop */ }
    inp.tabIndex = -1;
    function sync() {
      var v = btn.querySelector('.as-val');
      var t = fmt(inp.value);
      v.textContent = t || inp.getAttribute('placeholder') || 'اختر التاريخ';
      btn.classList.toggle('is-ph', !t);
      btn.disabled = inp.disabled;
    }
    inp.__asSync = sync; sync();
    new MutationObserver(sync).observe(inp, { attributes: true, attributeFilter: ['disabled', 'value'] });
    inp.addEventListener('change', sync);
    var lab = inp.id ? document.querySelector('label[for="' + inp.id + '"]') : null;
    if (lab) lab.addEventListener('click', function (e) { e.preventDefault(); btn.focus(); });
    btn.addEventListener('click', function () {
      if (current && current.owner === btn) { closeCurrent(); return; }
      openCalendar(btn, {
        value: inp.value, min: inp.getAttribute('min') || inp.dataset.min, max: inp.getAttribute('max') || inp.dataset.max,
        clearable: inp.dataset.required !== '1',
        onPick: function (v) {
          inp.value = v;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
        }
      });
    });
  }

  /* ───────────────────────── scan ───────────────────────── */
  var SEL = 'select:not([multiple]):not([size]):not(.wf-status-select-native):not([data-native]):not(.as-native)';
  var DATE = 'input[type="date"]:not(.as-native), input[data-athar-date]:not(.as-native)';
  function scan(root) {
    root = root || document;
    var list = root.querySelectorAll ? root.querySelectorAll(SEL) : [];
    Array.prototype.forEach.call(list, function (s) {
      if (s.closest('.as-pop') || s.getAttribute('aria-hidden') === 'true' || s.closest('[data-native-select]')) return;
      try { enhanceSelect(s); } catch (e) { /* keep native */ }
    });
    var dl = root.querySelectorAll ? root.querySelectorAll(DATE) : [];
    Array.prototype.forEach.call(dl, function (d) { try { enhanceDate(d); } catch (e) { /* keep native */ } });
  }
  var timer = null;
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; scan(document); }, 60); }
  function start() {
    scan(document);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.AtharUI = { scan: scan, enhanceSelect: enhanceSelect, enhanceDate: enhanceDate, openCalendar: openCalendar, close: closeCurrent, fmtDate: fmt };
})();
