/* global React, Icon, Num */
const { useState, useEffect } = React;

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = ((t.getHours() % 12) || 12).toString().padStart(2, "0");
  const mm = t.getMinutes().toString().padStart(2, "0");
  const ss = t.getSeconds().toString().padStart(2, "0");
  const ampm = t.getHours() >= 12 ? "PM" : "AM";
  return `${hh}:${mm}:${ss} ${ampm}`;
}

function TopBar({ onMobileMenu, theme, onToggleTheme, search, onSearchChange }) {
  const clock = useClock();
  return (
    <header className="mk-topbar">
      <div className="mk-brand">
        <div className="mk-brand__icon"><span className="mk-brand__mono">م</span></div>
        <div className="mk-brand__text">
          <strong>منصة الرصد</strong>
        </div>
      </div>

      <div className="mk-topbar__tools">
        <button
          className="mk-iconbtn mk-iconbtn--ghost mk-only-mobile"
          onClick={onMobileMenu}
          aria-label="القائمة"
        >
          <Icon name="bars" />
        </button>

        <div className="mk-topbar__search">
          <Icon name="magnifying-glass" style={{ color: "var(--mr-text-3)", fontSize: 13 }} />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ابحث في التذاكر، المخالفات، الموظفين، والفروع..."
          />
        </div>

        <div className="mk-clock" dir="ltr">
          <Icon name="clock" />
          <Num>{clock}</Num>
        </div>

        <button className="mk-iconbtn" aria-label="التنبيهات">
          <Icon name="bell" />
          <span className="mk-iconbtn__dot"><Num>3</Num></span>
        </button>

        <button className="mk-iconbtn" aria-label="الوضع" onClick={onToggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>

        <div className="mk-user">
          <div className="mk-user__av">ر</div>
          <div className="mk-user__info">
            <span className="mk-user__hello">مرحباً</span>
            <strong className="mk-user__name">رنا الزهراني</strong>
          </div>
        </div>
      </div>
    </header>
  );
}

window.TopBar = TopBar;
