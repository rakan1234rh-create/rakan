/* global React, ReactDOM, AppCtx,
   TopBar, Sidebar, Dashboard, WorkflowTable, NewTicketForm,
   LoginScreen, ComplianceView, ComingSoon */
const { useState, useEffect } = React;

const TAB_TITLES = {
  dashboard:  "لوحة القيادة",
  newTicket:  "رصد مخالفة جديدة",
  workflow:   "معالجة التذاكر",
  reports:    "التقارير",
  compliance: "مؤشرات الامتثال",
  locations:  "المناطق والفروع",
  departments:"المستخدمون",
  violations: "أنواع المخالفات",
};

function App() {
  const [signedIn, setSignedIn] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("light");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  if (!signedIn) {
    return <LoginScreen onSignIn={() => setSignedIn(true)} />;
  }

  const ctx = { tab, setTab, search, setSearch, theme, setTheme, signOut: () => setSignedIn(false) };

  const renderTab = () => {
    switch (tab) {
      case "dashboard":  return <Dashboard />;
      case "newTicket":  return <NewTicketForm />;
      case "workflow":   return <WorkflowTable />;
      case "compliance": return <ComplianceView />;
      case "reports":    return <ComingSoon title="التقارير" sub="رسوم بيانية وتحليلات على مستوى المنطقة والفرع" icon="chart-bar" />;
      case "locations":  return <ComingSoon title="المناطق والفروع" sub="إدارة المواقع والمشرفين" icon="map-location-dot" />;
      case "departments":return <ComingSoon title="المستخدمون" sub="الأدوار، الصلاحيات، والاعتماد" icon="users-gear" />;
      case "violations": return <ComingSoon title="أنواع المخالفات" sub="كتالوج المخالفات والخطورة والأوزان" icon="triangle-exclamation" />;
      default:           return <Dashboard />;
    }
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="mk-app" data-screen-label={`UI Kit · ${TAB_TITLES[tab] || tab}`}>
        <TopBar
          theme={theme}
          onToggleTheme={() => setTheme((v) => (v === "dark" ? "light" : "dark"))}
          onMobileMenu={() => setMobileOpen(true)}
          search={search}
          onSearchChange={setSearch}
        />
        <div className="mk-app__body">
          <main className="mk-app__main">
            <div className="mk-app__main-inner">{renderTab()}</div>
          </main>
          <Sidebar
            activeTab={tab}
            onTabChange={(id) => { setTab(id); setMobileOpen(false); }}
            mobileOpen={mobileOpen}
            onMobileClose={() => setMobileOpen(false)}
          />
        </div>
      </div>
    </AppCtx.Provider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
