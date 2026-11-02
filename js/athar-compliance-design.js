/* Compliance — desktop design (X_Compliance): company ring + branches table. */
(function () {
  'use strict';
  var BANDS = [[90, 'ممتاز', 'ex', '#1E9E6A'], [75, 'جيد', 'gd', '#2F6FDB'], [50, 'متوسط', 'md', '#D9A011'], [0, 'متعثر', 'bd', '#D6342C']];
  function band(n) { for (var i = 0; i < BANDS.length; i++) if (n >= BANDS[i][0]) return BANDS[i]; return BANDS[3]; }
  function html(m) {
    var e = m.esc, b = band(m.org), r = 50, C = 2 * Math.PI * r;
    var weak = m.rows.filter(function (x) { return x.score < 50; }).length, ex = m.rows.filter(function (x) { return x.score >= 90; }).length;
    var rows = m.rows.slice().sort(function (x, y) { return x.score - y.score; }).map(function (x) {
      var bb = band(x.score);
      return '<tr class="atq-tr" tabindex="0" onclick="cmpOpenBranchCompliance(\'' + e(x.id) + '\')"><td>' + e(x.name) + '</td><td>' + e(x.region) + '</td><td class="atd-mono">' + x.n + '</td><td class="atd-mono">' + x.v + '</td><td><span class="atq-chip atq-chip--' + bb[2] + '">' + x.score + '</span></td></tr>';
    }).join('') || '<tr><td colspan="5" class="atq-none">لا توجد فروع</td></tr>';
    return '<div class="atq-page"><header><p class="atd-kick">COMPLIANCE</p><h1 class="atd-h1">مؤشرات الامتثال</h1></header><section class="atq-sec">' +
      '<div class="atq-card atq-co"><h2>امتثال الشركة</h2><div class="atq-ringrow"><div class="atq-ring"><svg viewBox="0 0 120 120" width="112" height="112" aria-hidden="true"><circle cx="60" cy="60" r="' + r + '" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="10"></circle>' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + b[3] + '" stroke-width="10" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - Math.max(0, Math.min(100, m.org)) / 100)).toFixed(1) + '" transform="rotate(-90 60 60)"></circle></svg><span class="atq-rn">' + m.org + '</span></div>' +
      '<div><span class="atq-chip atq-chip--' + b[2] + '">' + b[1] + '</span><p class="atq-sub">فروع متعثرة: ' + weak + ' · ممتازة: ' + ex + '</p></div></div>' +
      '<div class="atq-strip" aria-hidden="true"><i style="flex:50;background:#D6342C"></i><i style="flex:25;background:#D9A011"></i><i style="flex:15;background:#2F6FDB"></i><i style="flex:10;background:#1E9E6A"></i><b style="right:' + Math.max(0, Math.min(100, m.org)) + '%"></b></div></div>' +
      '<div class="atq-card atq-tb"><div class="atq-hd"><h2>الفروع حسب الامتثال</h2><p>الأدنى أولًا</p></div><div class="atq-scroll"><table><thead><tr><th scope="col">الفرع</th><th scope="col">المنطقة</th><th scope="col">الموظفون</th><th scope="col">المخالفات</th><th scope="col">الامتثال</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></section></div>';
  }
  window.AtharComplianceDesign = { html: html };
})();
