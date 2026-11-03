/* Admin pages — desktop design: users table, page headers for users / broadcasts / permissions. */
(function () {
  'use strict';
  function usersTable(rows, canManage, e) {
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      var ini = (String(r.name || '').trim().charAt(0)) || '؟';
      return '<tr class="atu-tr atl-tr"><td><span class="atl-name"><span class="atl-ico atl-ico--av" aria-hidden="true">' + e(ini) + '</span><span>' + e(r.name) + '</span></span></td>' +
        '<td class="atd-mono atu-no">' + e(r.no) + '</td><td><span class="atl-pill">' + e(r.role) + '</span></td><td>' + e(r.branch) + '</td>' +
        '<td><span class="atu-st ' + (r.active ? 'is-on' : 'is-off') + '">' + (r.active ? 'نشط' : 'موقوف') + '</span></td>' +
        '<td class="atl-acts">' + (canManage ? '<button type="button" class="atl-btn" onclick="editUser(\'' + id + '\')"><i class="fas fa-pen" aria-hidden="true"></i>تعديل</button>' + (r.active ? '<button type="button" class="atl-btn atl-btn--del" title="تعطيل المستخدم" aria-label="تعطيل المستخدم" onclick="deleteUser(\'' + id + '\')"><i class="fas fa-user-slash" aria-hidden="true"></i>تعطيل</button>' : '') : '<span class="atd-mu">—</span>') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="atu-empty">لا يوجد مستخدمون</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table atl-table"><colgroup><col style="width:26%"><col style="width:12%"><col style="width:14%"><col style="width:18%"><col style="width:10%"><col style="width:220px"></colgroup><thead><tr><th scope="col">الاسم</th><th scope="col">الرقم الوظيفي</th><th scope="col">الدور</th><th scope="col">الفرع</th><th scope="col">الحالة</th><th scope="col"></th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function actBtns(canManage, canDelete, editFn, delFn, id, what) {
    return '<td class="atl-acts" onclick="event.stopPropagation()">' +
      (canManage ? '<button type="button" class="atl-btn" onclick="' + editFn + '(\'' + id + '\')"><i class="fas fa-pen" aria-hidden="true"></i>تعديل</button>' : '') +
      (canDelete ? '<button type="button" class="atl-btn atl-btn--del" aria-label="حذف ' + what + '" title="حذف ' + what + '" onclick="' + delFn + '(\'' + id + '\')"><i class="fas fa-trash" aria-hidden="true"></i>حذف</button>' : '') + '</td>';
  }
  function cnt(n, unit) { return '<span class="atl-pill"><b class="atd-mono">' + n + '</b> ' + unit + '</span>'; }
  function regionsTable(rows, canManage, canDelete, e) {
    var acts = canManage || canDelete;
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      return '<tr class="atu-tr atl-tr" tabindex="0" onclick="openRegionView(\'' + id + '\')"><td><span class="atl-name"><span class="atl-ico" aria-hidden="true"><i class="fas fa-map-location-dot"></i></span><span>' + e(r.name) + '</span></span></td>' +
        '<td>' + (r.sup ? '<span class="atl-sup"><i class="fas fa-user-tie" aria-hidden="true"></i>' + e(r.sup) + '</span>' : '<span class="atd-mu">لا يوجد مشرف</span>') + '</td>' +
        '<td>' + cnt(r.branches, 'فرع') + '</td><td>' + cnt(r.n, 'موظف') + '</td>' + (acts ? actBtns(canManage, canDelete, 'editRegion', 'deleteRegion', id, 'المنطقة') : '') +
        '<td class="atl-go" aria-hidden="true"><i class="fas fa-chevron-left"></i></td></tr>';
    }).join('') || '<tr><td colspan="7" class="atu-empty">لا توجد مناطق</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table atl-table"><colgroup><col style="width:28%"><col style="width:24%"><col style="width:11%"><col style="width:11%">' + (acts ? '<col style="width:210px">' : '') + '<col style="width:32px"></colgroup><thead><tr><th scope="col">المنطقة</th><th scope="col">المشرف</th><th scope="col">الفروع</th><th scope="col">الموظفون</th>' + (acts ? '<th scope="col"></th>' : '') + '<th scope="col"></th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function regionBranchesTable(rows, canManage, canDelete, e) {
    var band = function (n) { return n >= 90 ? 'ex' : n >= 75 ? 'gd' : n >= 50 ? 'md' : 'bd'; };
    var acts = canManage || canDelete;
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      return '<tr class="atu-tr atl-tr" tabindex="0" onclick="openLocBranchView(\'' + id + '\')"><td><span class="atl-name"><span class="atl-ico" aria-hidden="true"><i class="fas fa-store"></i></span><span>' + e(r.name) + '</span></span></td>' +
        '<td>' + (r.mgr ? '<span class="atl-sup"><i class="fas fa-user-tie" aria-hidden="true"></i>' + e(r.mgr) + '</span>' : '<span class="atd-mu">لا يوجد مدير</span>') + '</td>' +
        '<td>' + cnt(r.n, 'موظف') + '</td><td><span class="atq-chip atq-chip--' + band(r.score) + '">' + r.score + '</span></td>' + (acts ? actBtns(canManage, canDelete, 'editBranch', 'deleteBranch', id, 'الفرع') : '') +
        '<td class="atl-go" aria-hidden="true"><i class="fas fa-chevron-left"></i></td></tr>';
    }).join('') || '<tr><td colspan="6" class="atu-empty">لا توجد فروع</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table atl-table"><colgroup><col style="width:30%"><col style="width:26%"><col style="width:13%"><col style="width:12%">' + (acts ? '<col style="width:210px">' : '') + '<col style="width:32px"></colgroup><thead><tr><th scope="col">الفرع</th><th scope="col">مدير الفرع</th><th scope="col">الموظفون</th><th scope="col">الامتثال</th>' + (acts ? '<th scope="col"></th>' : '') + '<th scope="col"></th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function branchStaffTable(rows, e) {
    var body = rows.map(function (r) {
      return '<tr class="atu-tr"><td>' + e(r.name) + '</td><td class="atd-mono atu-no">' + e(r.no) + '</td><td>' + e(r.role) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="atu-empty">لا يوجد موظفون</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table"><thead><tr><th scope="col">الموظف</th><th scope="col">الرقم الوظيفي</th><th scope="col">الدور</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function drillHead(back, backLabel, kicker, title, sub, e) {
    return '<div class="atu-drill"><button type="button" class="atu-back" onclick="' + back + '"><span aria-hidden="true">→</span> ' + e(backLabel) + '</button>' +
      '<div class="atu-drill__t"><p class="atd-kick">' + e(kicker) + '</p><h2>' + e(title) + '</h2>' + (sub ? '<p class="atd-mu">' + e(sub) + '</p>' : '') + '</div></div>';
  }
  function branchesTable(rows, e) {
    var band = function (n) { return n >= 90 ? 'ex' : n >= 75 ? 'gd' : n >= 50 ? 'md' : 'bd'; };
    var body = rows.map(function (r) {
      return '<tr class="atu-tr" tabindex="0" onclick="openRegionView(\'' + e(r.rid) + '\');openLocBranchView(\'' + e(r.id) + '\')"><td>' + e(r.name) + '</td><td>' + e(r.region) + '</td><td>' + e(r.mgr) + '</td><td class="atd-mono atu-no">' + r.n + '</td><td><span class="atq-chip atq-chip--' + band(r.score) + '">' + r.score + '</span></td></tr>';
    }).join('') || '<tr><td colspan="5" class="atu-empty">لا توجد فروع</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table"><thead><tr><th scope="col">الفرع</th><th scope="col">المنطقة</th><th scope="col">المدير</th><th scope="col">الموظفون</th><th scope="col">الامتثال</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function typesTable(rows, canManage, e) {
    var cls = { 'عالي': 'hi', 'متوسط': 'md', 'منخفض': 'lo' }, lbl = { 'عالي': 'عالية', 'متوسط': 'متوسطة', 'منخفض': 'منخفضة' };
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      return '<tr class="atu-tr" tabindex="0" onclick="openViolDetailSheet(\'' + id + '\')"><td>' + e(r.name) + '</td><td><span class="atd-sev atd-sev--' + (cls[r.sev] === 'hi' ? 'hi' : cls[r.sev] === 'md' ? 'med' : 'low') + '">' + e(lbl[r.sev] || r.sev) + '</span></td><td class="atd-mono atu-no">−' + e(r.pts) + '</td><td>' + e(r.cat) + '</td>' +
        (canManage ? '<td onclick="event.stopPropagation()"><button type="button" class="atu-edit" onclick="editViolType(\'' + id + '\')">تعديل</button></td>' : '') + '</tr>';
    }).join('') || '<tr><td colspan="5" class="atu-empty">لا توجد أنواع مخالفات</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table"><thead><tr><th scope="col">النوع</th><th scope="col">الخطورة</th><th scope="col">النقاط</th><th scope="col">الفئة</th>' + (canManage ? '<th scope="col"></th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  var HEADS = { departments: ['USER MANAGEMENT', 'إدارة المستخدمين', '.wf-panel'], broadcasts: ['MOBILE BROADCASTS', 'النشرات', '.bc-page'], settings: ['PLATFORM PERMISSIONS', 'الصلاحيات', '#tab-settings', true], locations: ['REGIONS & BRANCHES', 'المناطق والفروع', '#tab-locations', true], violations: ['VIOLATION TYPES', 'أنواع المخالفات', '#tab-violations', true] };
  function mount() {
    var h = document.documentElement; if (!h.classList.contains('mr-desktop-ui')) return;
    Object.keys(HEADS).forEach(function (k) {
      var tab = document.getElementById('tab-' + k); if (!tab || tab.hidden || !tab.offsetParent) return;
      var root = HEADS[k][3] ? tab : tab.querySelector(HEADS[k][2]); if (!root || root.querySelector(':scope > .atu-head')) return;
      var d = document.createElement('div'); d.className = 'atu-head';
      d.innerHTML = '<p class="atd-kick">' + HEADS[k][0] + '</p><h1 class="atd-h1">' + HEADS[k][1] + '</h1>';
      root.insertBefore(d, root.firstChild);
    });
    [['locations', 'المناطق والفروع', 'atuLocCount', 'regions-count', ' منطقة'], ['violations', 'أنواع المخالفات', 'atuVtCount', 'viol-types-count', ' أنواع']].forEach(function (c) {
      var t = document.getElementById('tab-' + c[0]); if (!t || !t.offsetParent) return;
      var p = t.querySelector('.wf-panel'); if (!p) return;
      if (!p.querySelector(':scope > .atu-card-hd')) { var d = document.createElement('div'); d.className = 'atu-card-hd'; d.innerHTML = '<h2>' + c[1] + '</h2><p id="' + c[2] + '"></p>'; p.insertBefore(d, p.firstChild); }
      var n = document.getElementById(c[3]), el = document.getElementById(c[2]);
      if (c[0] === 'violations' && n && el) el.textContent = n.textContent + c[4];
    });
    var tab = document.getElementById('tab-departments');
    if (tab && tab.offsetParent) {
      var host = document.getElementById('usersDeskHost');
      if (host && !host.querySelector(':scope > .atu-card-hd')) {
        var c = document.createElement('div'); c.className = 'atu-card-hd'; c.innerHTML = '<h2>إدارة المستخدمين</h2><p id="atuCount"></p>'; host.insertBefore(c, host.firstChild);
      }
      var n = document.getElementById('users-count'), t = document.getElementById('atuCount');
      if (n && t) t.textContent = n.textContent + ' مستخدمًا';
    }
  }
  setInterval(mount, 1000);
  window.AtharAdminDesign = { regionBranchesTable: regionBranchesTable, branchStaffTable: branchStaffTable, drillHead: drillHead, regionsTable: regionsTable, usersTable: usersTable, branchesTable: branchesTable, typesTable: typesTable };
})();
