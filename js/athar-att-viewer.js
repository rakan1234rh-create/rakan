/* Attachment viewer: square close button + zoom in/out (buttons, pinch, wheel, double-tap) for images.
   Works on top of the existing viewer; it never replaces its DOM, only transforms the <img>. */
(function () {
  'use strict';
  var MIN = 1, MAX = 5;
  var V = null, bar = null, img = null;
  var st = { s: 1, x: 0, y: 0 };
  var ptrs = new Map(), g = null, lastTap = 0;

  function viewer() { return V || (V = document.getElementById('attViewer')); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function target() {
    var v = viewer(); if (!v) return null;
    var i = v.querySelector('#attViewerContent img, .att-viewer-content img');
    return i && i.offsetWidth > 0 ? i : null;
  }
  function limit() {
    if (!img) return { x: 0, y: 0 };
    var w = img.offsetWidth * st.s, h = img.offsetHeight * st.s;
    return { x: Math.max(0, (w - window.innerWidth) / 2), y: Math.max(0, (h - window.innerHeight) / 2) };
  }
  function apply(animate) {
    if (!img) return;
    var l = limit(); st.x = clamp(st.x, -l.x, l.x); st.y = clamp(st.y, -l.y, l.y);
    img.style.transition = animate ? 'transform .18s ease' : 'none';
    img.style.transform = st.s === 1 && !st.x && !st.y ? '' : 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
    img.style.transformOrigin = 'center center';
    var v = viewer(); if (v) v.classList.toggle('is-zoomed', st.s > 1.02);
    var lab = bar && bar.querySelector('.aav-pct'); if (lab) lab.textContent = Math.round(st.s * 100) + '%';
    var bi = bar && bar.querySelector('[data-aav="in"]'), bo = bar && bar.querySelector('[data-aav="out"]');
    if (bi) bi.disabled = st.s >= MAX - 0.01; if (bo) bo.disabled = st.s <= MIN + 0.01;
  }
  function reset(animate) { st.s = 1; st.x = 0; st.y = 0; apply(animate); }
  /* zoom to scale ns keeping screen point (px,py) fixed */
  function zoomAt(ns, px, py, animate) {
    if (!img) return;
    ns = clamp(ns, MIN, MAX);
    var r = img.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var ux = (px - cx) / st.s, uy = (py - cy) / st.s;
    var cx0 = cx - st.x, cy0 = cy - st.y;
    st.x = (px - ux * ns) - cx0; st.y = (py - uy * ns) - cy0; st.s = ns;
    if (ns <= 1.001) { st.s = 1; st.x = 0; st.y = 0; }
    apply(animate);
  }
  function center() { return { x: window.innerWidth / 2, y: window.innerHeight / 2 }; }

  function build() {
    var v = viewer(); if (!v || bar) return;
    bar = document.createElement('div'); bar.className = 'aav-bar'; bar.setAttribute('dir', 'ltr');
    bar.innerHTML =
      '<button type="button" data-aav="out" aria-label="تصغير"><i class="fas fa-minus"></i></button>' +
      '<span class="aav-pct" aria-live="polite">100%</span>' +
      '<button type="button" data-aav="in" aria-label="تكبير"><i class="fas fa-plus"></i></button>' +
      '<button type="button" data-aav="reset" aria-label="إعادة الحجم"><i class="fas fa-expand"></i></button>';
    v.appendChild(bar);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-aav]'); if (!b) return; e.stopPropagation();
      img = target(); if (!img) return;
      var k = b.getAttribute('data-aav'), c = center();
      if (k === 'in') zoomAt(st.s * 1.5, c.x, c.y, true);
      else if (k === 'out') zoomAt(st.s / 1.5, c.x, c.y, true);
      else reset(true);
    });
    ['pointerdown', 'pointerup', 'touchstart'].forEach(function (t) { bar.addEventListener(t, function (e) { e.stopPropagation(); }); });

    /* gestures: capture on the viewer so we run before the drag-to-close handler */
    v.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, a, .aav-bar')) return;
      var t = target(); if (!t || !(e.target === t || t.contains(e.target))) return;
      img = t; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2 || st.s > 1.02) {
        e.stopPropagation();
        try { v.setPointerCapture(e.pointerId); } catch (_) {}
      }
      startGesture();
    }, true);
    v.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId) || !g) return;
      var p = ptrs.get(e.pointerId); var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2) {
        e.stopPropagation(); e.preventDefault();
        var a = Array.from(ptrs.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        var mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        if (g.d0 > 0) {
          var ns = clamp(g.s0 * d / g.d0, MIN, MAX);
          zoomAt(ns, mx, my, false);
          st.x += mx - g.mx; st.y += my - g.my; apply(false);
        }
        g.mx = mx; g.my = my;
      } else if (st.s > 1.02) {
        e.stopPropagation(); e.preventDefault();
        st.x += dx; st.y += dy; apply(false);
      }
    }, true);
    function end(e) {
      if (!ptrs.has(e.pointerId)) return;
      var wasSingle = ptrs.size === 1; ptrs.delete(e.pointerId);
      if (ptrs.size < 2) { g = null; if (ptrs.size === 1) startGesture(); }
      if (st.s < 1.05 && st.s > 1) reset(true);
      if (wasSingle && e.type === 'pointerup' && e.target === img && !moved(e)) {
        var now = Date.now();
        if (now - lastTap < 300) { lastTap = 0; zoomAt(st.s > 1.02 ? 1 : 2.5, e.clientX, e.clientY, true); e.stopPropagation(); }
        else lastTap = now;
      }
    }
    v.addEventListener('pointerup', end, true);
    v.addEventListener('pointercancel', end, true);
    v.addEventListener('wheel', function (e) {
      var t = target(); if (!t) return; img = t; e.preventDefault(); e.stopPropagation();
      zoomAt(st.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY, false);
    }, { passive: false, capture: true });
    v.addEventListener('dblclick', function (e) {
      var t = target(); if (!t || e.target !== t) return; img = t; e.preventDefault(); e.stopPropagation();
      zoomAt(st.s > 1.02 ? 1 : 2.5, e.clientX, e.clientY, true);
    }, true);
  }
  var downAt = null;
  function moved(e) { return false; }
  function startGesture() {
    var a = Array.from(ptrs.values());
    g = { s0: st.s, d0: a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0, mx: a.length >= 2 ? (a[0].x + a[1].x) / 2 : 0, my: a.length >= 2 ? (a[0].y + a[1].y) / 2 : 0 };
  }

  function sync() {
    var v = viewer(); if (!v) return;
    var open = v.classList.contains('open');
    if (open) build();
    var t = open ? target() : null;
    if (t !== img) { img = t; ptrs.clear(); g = null; st = { s: 1, x: 0, y: 0 }; if (t) apply(false); }
    var want = t ? '' : 'none'; if (bar && bar.style.display !== want) bar.style.display = want;
    if (!open) { st = { s: 1, x: 0, y: 0 }; if (v.classList.contains('is-zoomed')) v.classList.remove('is-zoomed'); }
  }
  function init() {
    var v = viewer(); if (!v) return;
    new MutationObserver(sync).observe(v, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('keydown', function (e) {
    var v = viewer(); if (!v || !v.classList.contains('open') || !target()) return;
    img = target(); var c = center();
    if (e.key === '+' || e.key === '=') zoomAt(st.s * 1.5, c.x, c.y, true);
    else if (e.key === '-') zoomAt(st.s / 1.5, c.x, c.y, true);
    else if (e.key === '0') reset(true);
  });
})();
