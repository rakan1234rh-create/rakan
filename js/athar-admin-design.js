/* Admin pages — desktop design: users table, page headers for users / broadcasts / permissions. */
(function () {
  'use strict';
  function usersTable(rows, canManage, e) {
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      return '<tr class="atu-tr"><td>' + e(r.name) + '</td><td class="atd-mono atu-no">' + e(r.no) + '</td><td>' + e(r.role) + '</td><td>' + e(r.branch) + '</td>' +
        '<td><span class="atu-st ' + (r.active ? 'is-on' : 'is-off') + '">' + (r.active ? 'نشط' : 'موقوف') + '</span></td>' +
        '<td>' + (canManage ? '<button type="button" class="atu-edit" onclick="editUser(\'' + id + '\')">تعديل</button>' + (r.active ? '<button type="button" class="atu-off" onclick="deleteUser(\'' + id + '\')">تعطيل</button>' : '') : '<span class="atd-mu">—</span>') + '</td></tr>';
    }).join('');
    return '<div class="atu-scroll"><table class="atu-table"><thead><tr><th scope="col">الاسم</th><th scope="col">الرقم الوظيفي</th><th scope="col">الدور</th><th scope="col">الفرع</th><th scope="col">الحالة</th><th scope="col">إجراء</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function regionsTable(rows, canManage, canDelete, e) {
    var acts = canManage || canDelete;
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      return '<tr class="atu-tr" tabindex="0" onclick="openRegionView(\'' + id + '\')"><td>' + e(r.name) + '</td><td>' + (r.sup ? e(r.sup) : '<span class="atd-mu">لا يوجد مشرف</span>') + '</td><td class="atd-mono atu-no">' + r.branches + '</td><td class="atd-mono atu-no">' + r.n + '</td>' +
        (acts ? '<td onclick="event.stopPropagation()">' + (canManage ? '<button type="button" class="atu-edit" onclick="editRegion(\'' + id + '\')">تعديل / المشرف</button>' : '') + (canDelete ? '<button type="button" class="atu-off" onclick="deleteRegion(\'' + id + '\')">حذف</button>' : '') + '</td>' : '') + '</tr>';
    }).join('') || '<tr><td colspan="5" class="atu-empty">لا توجد مناطق</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table"><thead><tr><th scope="col">المنطقة</th><th scope="col">المشرف</th><th scope="col">الفروع</th><th scope="col">الموظفون</th>' + (acts ? '<th scope="col">إجراء</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function regionBranchesTable(rows, canManage, canDelete, e) {
    var band = function (n) { return n >= 90 ? 'ex' : n >= 75 ? 'gd' : n >= 50 ? 'md' : 'bd'; };
    var acts = canManage || canDelete;
    var body = rows.map(function (r) {
      var id = e(r.id).replace(/'/g, '&#39;');
      return '<tr class="atu-tr" tabindex="0" onclick="openLocBranchView(\'' + id + '\')"><td>' + e(r.name) + '</td><td>' + (r.mgr ? e(r.mgr) : '<span class="atd-mu">لا يوجد مدير</span>') + '</td><td class="atd-mono atu-no">' + r.n + '</td><td><span class="atq-chip atq-chip--' + band(r.score) + '">' + r.score + '</span></td>' +
        (acts ? '<td onclick="event.stopPropagation()">' + (canManage ? '<button type="button" class="atu-edit" onclick="editBranch(\'' + id + '\')">تعديل</button>' : '') + (canDelete ? '<button type="button" class="atu-off" onclick="deleteBranch(\'' + id + '\')">حذف</button>' : '') + '</td>' : '') + '</tr>';
    }).join('') || '<tr><td colspan="5" class="atu-empty">لا توجد فروع</td></tr>';
    return '<div class="atu-scroll"><table class="atu-table"><thead><tr><th scope="col">الفرع</th><th scope="col">المدير</th><th scope="col">الموظفون</th><th scope="col">الامتثال</th>' + (acts ? '<th scope="col">إجراء</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
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
