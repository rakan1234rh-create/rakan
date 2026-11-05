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
  function drill(m) {
    var e = m.esc;
    var rows = m.rows.map(function (x) {
      var bb = band(x.score);
      return '<tr class="atq-tr"' + (x.click ? ' tabindex="0" onclick="' + x.click + '"' : '') + '>' + x.cells.map(function (c, i) { return '<td' + (i > 0 && /^\d+$/.test(String(c)) ? ' class="atd-mono"' : '') + '>' + e(c) + '</td>'; }).join('') + '<td><span class="atq-chip atq-chip--' + bb[2] + '">' + x.score + '</span></td></tr>';
    }).join('') || '<tr><td colspan="' + (m.cols.length + 1) + '" class="atq-none">' + e(m.empty || 'لا توجد بيانات') + '</td></tr>';
    return '<div class="atq-page"><header class="atq-drill"><button type="button" class="atq-back" onclick="' + m.back + '"><span aria-hidden="true">→</span> ' + e(m.backLabel) + '</button><div><p class="atd-kick">' + e(m.kicker) + '</p><h1 class="atd-h1">' + e(m.title) + '</h1>' + (m.sub ? '<p class="atq-sub">' + e(m.sub) + '</p>' : '') + '</div></header>' +
      '<section class="atq-sec atq-sec--one"><div class="atq-card atq-tb"><div class="atq-scroll"><table><thead><tr>' + m.cols.map(function (c) { return '<th scope="col">' + e(c) + '</th>'; }).join('') + '<th scope="col">الامتثال</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></section></div>';
  }

  var PERIODS = [['all', 'كامل الفترة'], ['month', 'شهري'], ['week', 'أسبوعي']];
  function chip(n) { var b = band(n); return '<span class="atq-chip atq-chip--' + b[2] + '">' + n + '</span>'; }
  function page(m) {
    var e = m.esc, b = band(m.org.score), r = 50, C = 2 * Math.PI * r;
    var seg = '<div class="atq-seg" role="group" aria-label="الفترة">' + PERIODS.map(function (p) {
      return '<button type="button" class="atq-seg__b' + (m.period === p[0] ? ' is-on' : '') + '" aria-pressed="' + (m.period === p[0]) + '" onclick="cmpSetPeriod(\'' + p[0] + '\')">' + p[1] + '</button>';
    }).join('') + '</div>';
    var back = m.back ? '<button type="button" class="atq-back" onclick="' + m.back + '"><span aria-hidden="true">→</span> ' + e(m.backLabel) + '</button>' : '';
    var head = '<header class="atq-top"><div><p class="atd-kick">COMPLIANCE</p><h1 class="atd-h1">مؤشرات الامتثال</h1></div>' + seg + '</header>';
    var ring = '<div class="atq-card atq-co"><h2>' + e(m.org.label) + '</h2><div class="atq-ringrow"><div class="atq-ring"><svg viewBox="0 0 120 120" width="112" height="112" aria-hidden="true"><circle cx="60" cy="60" r="' + r + '" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="10"></circle>' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + b[3] + '" stroke-width="10" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - Math.max(0, Math.min(100, m.org.score)) / 100)).toFixed(1) + '" transform="rotate(-90 60 60)"></circle></svg><span class="atq-rn">' + m.org.score + '</span></div>' +
      '<div><span class="atq-chip atq-chip--' + b[2] + '">' + b[1] + '</span><p class="atq-sub">' + e(m.org.note) + '</p></div></div>' +
      '<div class="atq-strip" aria-hidden="true"><i style="flex:50;background:#D6342C"></i><i style="flex:25;background:#D9A011"></i><i style="flex:15;background:#2F6FDB"></i><i style="flex:10;background:#1E9E6A"></i><b style="right:' + Math.max(0, Math.min(100, m.org.score)) + '%"></b></div></div>';
    function pc(kind, label, x) {
      if (!x) return '';
      return '<div class="atq-pk"><p class="atq-pk__l">' + (kind === 'best' ? 'أفضل ' : 'أقل ') + e(label) + '</p><div class="atq-pk__r"><div class="atq-pk__t"><b>' + e(x.name) + '</b>' + (x.sub ? '<span>' + e(x.sub) + '</span>' : '') + '</div>' + chip(x.score) + '</div></div>';
    }
    var picks = '<div class="atq-picks">' + m.picks.map(function (p) {
      return '<div class="atq-card atq-pkc">' + pc('best', p.label, p.best) + pc('worst', p.label, p.worst) + '</div>';
    }).join('') + '</div>';
    var rows = m.rows.map(function (x) {
      return '<tr class="atq-tr"' + (x.click ? ' tabindex="0" onclick="' + x.click + '"' : '') + '>' + x.cells.map(function (c, i) { return '<td' + (i > 0 && /^\d+$/.test(String(c)) ? ' class="atd-mono"' : '') + '>' + e(c) + '</td>'; }).join('') + '<td>' + chip(x.score) + '</td></tr>';
    }).join('') || '<tr><td colspan="' + (m.cols.length + 1) + '" class="atq-none">لا توجد بيانات</td></tr>';
    var table = '<div class="atq-card atq-tb atq-tb--full"><div class="atq-hd atq-hd--row"><div><p class="atd-kick">' + e(m.kicker) + '</p><h2>' + e(m.title) + '</h2><p>' + e(m.sub) + ' · الأدنى أولًا</p></div>' + back + '</div><div class="atq-scroll"><table><thead><tr>' +
      m.cols.map(function (c) { return '<th scope="col">' + e(c) + '</th>'; }).join('') + '<th scope="col">الامتثال</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    return '<div class="atq-page">' + head + '<section class="atq-sec atq-sec--sum">' + ring + picks + '</section><section class="atq-sec atq-sec--one">' + table + '</section></div>';
  }
  window.AtharComplianceDesign = { html: html, drill: drill, page: page };
})();
