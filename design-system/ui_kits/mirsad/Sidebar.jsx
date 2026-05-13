/* global React, Icon, Num */

const NAV_SECTIONS = [
  {
    title: "الرئيسية",
    items: [
      { id: "dashboard",  icon: "chart-line",         label: "لوحة القيادة" },
      { id: "newTicket",  icon: "pen-to-square",      label: "رصد مخالفة" },
      { id: "workflow",   icon: "inbox",              label: "معالجة التذاكر", badge: 7 },
      { id: "reports",    icon: "chart-column",       label: "التقارير" },
      { id: "compliance", icon: "shield-halved",      label: "مؤشرات الامتثال" },
    ],
  },
  {
    title: "الإعدادات",
    items: [
      { id: "locations",   icon: "location-dot",       label: "المناطق والفروع" },
      { id: "departments", icon: "users-gear",         label: "المستخدمون" },
      { id: "violations",  icon: "list-ul",            label: "أنواع المخالفات" },
    ],
  },
];

function Sidebar({ activeTab, onTabChange, mobileOpen, onMobileClose }) {
  return (
    <React.Fragment>
      <div
        className={`mk-sb-overlay ${mobileOpen ? "is-open" : ""}`}
        onClick={onMobileClose}
      />
      <aside className={`mk-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <button className="mk-sb-close" onClick={onMobileClose} aria-label="إغلاق">
          <Icon name="xmark" />
        </button>
        <nav className="mk-sb-nav">
          {NAV_SECTIONS.map((sec) => (
            <React.Fragment key={sec.title}>
              <div className="mk-sb-section">{sec.title}</div>
              {sec.items.map((it) => (
                <button
                  key={it.id}
                  className={`mk-nav-item ${activeTab === it.id ? "is-active" : ""}`}
                  onClick={() => onTabChange(it.id)}
                >
                  <i className={`fas fa-${it.icon}`} aria-hidden="true"></i>
                  <span className="mk-nav-item__label">{it.label}</span>
                  {it.badge ? <span className="mk-nav-badge"><Num>{it.badge}</Num></span> : null}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="mk-sb-user">
          <button className="mk-logout">
            <Icon name="arrow-right-from-bracket" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </React.Fragment>
  );
}

window.Sidebar = Sidebar;
window.NAV_SECTIONS = NAV_SECTIONS;
