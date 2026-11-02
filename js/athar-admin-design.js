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
  var HEADS = { departments: ['USER MANAGEMENT', 'إدارة المستخدمين', '.wf-panel'], broadcasts: ['MOBILE BROADCASTS', 'النشرات', '.bc-page'], settings: ['PLATFORM PERMISSIONS', 'الصلاحيات', '#tab-settings', true] };
  function mount() {
    var h = document.documentElement; if (!h.classList.contains('mr-desktop-ui')) return;
    Object.keys(HEADS).forEach(function (k) {
      var tab = document.getElementById('tab-' + k); if (!tab || tab.hidden || !tab.offsetParent) return;
      var root = HEADS[k][3] ? tab : tab.querySelector(HEADS[k][2]); if (!root || root.querySelector(':scope > .atu-head')) return;
      var d = document.createElement('div'); d.className = 'atu-head';
      d.innerHTML = '<p class="atd-kick">' + HEADS[k][0] + '</p><h1 class="atd-h1">' + HEADS[k][1] + '</h1>';
      root.insertBefore(d, root.firstChild);
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
  window.AtharAdminDesign = { usersTable: usersTable };
})();
