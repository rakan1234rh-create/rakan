/* Complaints & suggestions — desktop design (E_Complaints) for non-managing roles. */
(function () {
  'use strict';
  var S = { kind: 'complaint', anon: false, title: '', body: '', busy: false };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fdate(iso) { var d = new Date(iso); if (isNaN(d)) return ''; try { return d.toLocaleDateString('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return ''; } }
  function titleOf(r) {
    var line = String(r.description || '').split('\n')[0].trim();
    if (r.description && String(r.description).indexOf('\n') > -1 && line) return line.slice(0, 70);
    return (r.category || (r.kind === 'suggestion' ? 'اقتراح' : 'شكوى'));
  }
  function opt(group, id, val, label, on) {
    return '<label class="atc-opt' + (on ? ' is-on' : '') + '" for="' + id + '"><input id="' + id + '" type="radio" name="' + group + '" value="' + val + '"' + (on ? ' checked' : '') + '>' + label + '</label>';
  }
  function formHtml() {
    return '<form class="atc-card atc-form" onsubmit="return false">' +
      '<fieldset><legend>نوع الطلب</legend><div class="atc-opts">' + opt('kind', 'k-c', 'complaint', 'شكوى', S.kind === 'complaint') + opt('kind', 'k-s', 'suggestion', 'اقتراح', S.kind === 'suggestion') + '</div></fieldset>' +
      '<fieldset><legend>طريقة الإرسال</legend><div class="atc-opts">' + opt('mode', 'm-n', 'named', 'باسمي', !S.anon) + opt('mode', 'm-a', 'anon', 'بشكل مجهول', S.anon) + '</div><p class="atc-hint">في الإرسال المجهول لا يظهر اسمك ولا رقمك الوظيفي لأي جهة.</p></fieldset>' +
      '<div class="atc-f"><label for="csub">العنوان</label><input id="csub" type="text" maxlength="70" placeholder="اكتب عنوانًا مختصرًا" value="' + esc(S.title) + '"></div>' +
      '<div class="atc-f"><label for="cbody">التفاصيل</label><textarea id="cbody" rows="6">' + esc(S.body) + '</textarea></div>' +
      '<button type="submit" class="atc-send" id="atcSend">إرسال</button></form>';
  }
  function listHtml(ctx) {
    var items = ctx.rows.map(function (r) {
      var done = r.status === 'resolved', bad = r.status === 'rejected';
      return '<div class="atc-item" role="button" tabindex="0" data-atc-open="' + esc(r.id) + '"><div class="atc-i1"><span class="atc-t">' + esc(titleOf(r)) + '</span><span class="atc-d">' + esc(fdate(r.created_at)) + '</span></div>' +
        '<div class="atc-i2"><span class="atc-kind">' + (r.kind === 'suggestion' ? 'اقتراح' : 'شكوى') + '</span><span class="atc-st' + (done ? ' is-ok' : bad ? ' is-bad' : ' is-wait') + '">' + esc(ctx.status[r.status] || r.status || '') + '</span></div></div>';
    }).join('') || '<div class="atc-none">لا توجد طلبات سابقة</div>';
    return '<h2>طلباتي السابقة</h2>' + items;
  }
  function render(host, ctx) {
    S.ctx = ctx;
    if (!host.querySelector('.atc-page')) {
      host.innerHTML = '<div class="atc-page"><header class="atc-hd"><p class="atd-kick">COMPLAINTS &amp; SUGGESTIONS</p><h1 class="atd-h1">الشكاوى والاقتراحات</h1></header>' +
        '<section class="atc-sec">' + formHtml() + '<aside class="atc-card atc-side" id="atcSide" aria-label="طلباتي"></aside></section></div>';
    }
    host.querySelector('#atcSide').innerHTML = listHtml(ctx);
  }
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.closest || !t.closest('.atc-form')) return;
    if (t.name === 'kind') S.kind = t.value; if (t.name === 'mode') S.anon = t.value === 'anon';
    t.closest('.atc-form').querySelectorAll('.atc-opt').forEach(function (l) { var i = l.querySelector('input'); l.classList.toggle('is-on', !!(i && i.checked)); });
  });
  document.addEventListener('input', function (e) { var t = e.target; if (!t) return; if (t.id === 'csub') S.title = t.value; if (t.id === 'cbody') S.body = t.value; });
  document.addEventListener('click', function (e) {
    var it = e.target.closest && e.target.closest('[data-atc-open]'); if (it && S.ctx) { S.ctx.open(it.getAttribute('data-atc-open')); return; }
    var b = e.target.closest && e.target.closest('#atcSend'); if (!b || !S.ctx || S.busy) return;
    var body = S.body.trim(); if (!body) { if (window.showToast) window.showToast('اكتب التفاصيل قبل الإرسال', 'warning'); return; }
    var text = S.title.trim() ? S.title.trim() + '\n' + body : body;
    S.busy = true; b.disabled = true;
    Promise.resolve(S.ctx.submit(S.kind, S.anon, text)).then(function (ok) {
      if (ok) { S.title = ''; S.body = ''; var f = document.querySelector('.atc-form'); if (f) { f.outerHTML = formHtml(); } }
    }).catch(function () {}).then(function () { S.busy = false; var n = document.getElementById('atcSend'); if (n) n.disabled = false; });
  });
  window.AtharCmplDesign = { render: render };
})();
