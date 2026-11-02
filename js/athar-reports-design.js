/* Reports — desktop design (M_Reports). */
(function () {
  'use strict';
  function html(m) {
    var e = m.esc;
    var max = Math.max.apply(null, m.months.map(function (x) { return x.n; }).concat([1]));
    var W = 58, H = 140;
    var bars = m.months.map(function (x, i) {
      var h = Math.round(x.n / max * 110), cx = 12 + i * W;
      return '<rect x="' + cx + '" y="' + (H - h) + '" width="34" height="' + h + '" fill="currentColor"></rect>' +
        '<text x="' + (cx + 17) + '" y="' + (H - h - 6) + '" text-anchor="middle" class="atp-v">' + x.n + '</text>' +
        '<text x="' + (cx + 17) + '" y="' + (H + 18) + '" text-anchor="middle" class="atp-l">' + e(x.l) + '</text>';
    }).join('');
    var tmax = Math.max.apply(null, m.tops.map(function (t) { return t.n; }).concat([1]));
    var tops = m.tops.length ? m.tops.map(function (t) {
      return '<div class="atp-top"><span class="atp-tn">' + e(t.name) + '</span><div class="atp-tr" role="img" aria-label="' + e(t.name + ': ' + t.n) + '"><div style="width:' + Math.round(t.n / tmax * 100) + '%"></div></div><span class="atd-mono atp-tv">' + t.n + '</span></div>';
    }).join('') : '<div class="atp-none">لا توجد مخالفات هذا الشهر</div>';
    return '<div class="atp-page"><header><p class="atd-kick">REPORTS</p><h1 class="atd-h1">التقارير</h1></header>' +
      '<section class="atp-kpis">' + m.kpis.map(function (k) { return '<div class="atp-card atp-kpi"><div class="atp-n">' + e(k[0]) + '</div><div class="atp-kl">' + e(k[1]) + '</div></div>'; }).join('') + '</section>' +
      '<section class="atp-two"><div class="atp-card atp-ch"><div class="atp-hd"><h2>المخالفات الشهرية</h2><p>آخر 6 أشهر</p></div>' +
      '<svg viewBox="0 0 ' + (12 + 6 * W) + ' 160" role="img" aria-label="المخالفات الشهرية" class="atp-svg">' + bars + '<line x1="0" y1="' + H + '" x2="' + (12 + 6 * W) + '" y2="' + H + '" stroke="currentColor" opacity=".25"></line></svg></div>' +
      '<div class="atp-card atp-tp"><div class="atp-hd"><h2>أكثر المخالفات تكرارًا</h2><p>' + e(m.month + ' ' + m.year) + '</p></div>' + tops + '</div></section>' +
      '<section class="atp-act"><button type="button" class="atp-pb" onclick="exportReportExcel()">تصدير Excel</button><button type="button" class="atp-gb" onclick="exportReportsSummaryPDF()">تصدير PDF</button></section></div>';
  }
  window.AtharReportsDesign = { html: html };
})();
