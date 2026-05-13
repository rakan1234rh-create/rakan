/* global React, Icon, Num, Card, Button, Badge, useApp, STATE_LABELS */

function StatCard({ label, value, foot, footTone = "muted", iconTile, icon }) {
  return (
    <div className="mk-stat-card">
      <div className="mk-stat-card__copy">
        <p className="mk-stat-card__label">{label}</p>
        <div className="mk-stat-card__value mk-num">{value}</div>
        <div className={`mk-stat-card__foot mk-stat-card__foot--${footTone}`}>
          <Icon name={foot.icon} />
          <span>{foot.text}</span>
        </div>
      </div>
      <div className={`mk-stat-card__ico mk-stat-card__ico--${iconTile}`}>
        <Icon name={icon} />
      </div>
    </div>
  );
}

function RecentRow({ tone, icon, title, desc, time, state }) {
  const s = STATE_LABELS[state] || { label: "—", tone: "gray" };
  return (
    <div className="mk-recent">
      <div className={`mk-recent__icon mk-recent__icon--${tone}`}>
        <Icon name={icon} />
      </div>
      <div className="mk-recent__body">
        <p className="mk-recent__title">{title}</p>
        <p className="mk-recent__desc">{desc}</p>
        <p className="mk-recent__time mk-num">{time}</p>
      </div>
      <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>
      <Icon name="arrow-left" style={{ color: "var(--mr-text-3)", fontSize: 12, alignSelf: "center", marginInlineStart: 4 }} />
    </div>
  );
}

function StateBar({ label, count, max, tone }) {
  const pct = Math.max(4, Math.round((count / max) * 100));
  return (
    <div className="mk-state-row">
      <div className="mk-state-row__head">
        <span className="mk-state-row__label">{label}</span>
        <span className="mk-state-row__count mk-num">{count}</span>
      </div>
      <div className="mk-state-row__bar">
        <div className={`mk-state-row__fill mk-fill--${tone}`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

function Dashboard() {
  const app = useApp();

  return (
    <div className="mk-dash">
      <div className="mk-hero">
        <h1 className="mk-hero__title">
          مرحباً بك، رنا{" "}
          <span className="mk-hero__wave" aria-hidden="true">👋</span>
        </h1>
        <p className="mk-hero__sub">إليك نظرة عامة على أداء منصتك اليوم</p>
      </div>

      <div className="mk-stats-grid">
        <StatCard
          label="إجمالي المخالفات"
          value="1,248"
          foot={{ icon: "arrow-trend-up", text: "هذا الشهر" }}
          footTone="muted"
          iconTile="blue"
          icon="file-lines"
        />
        <StatCard
          label="معتمدة نهائياً"
          value="874"
          foot={{ icon: "circle-check", text: "70% من الإجمالي" }}
          footTone="up"
          iconTile="green"
          icon="check-double"
        />
        <StatCard
          label="قيد المعالجة"
          value="312"
          foot={{ icon: "clock", text: "بانتظار رد" }}
          footTone="muted"
          iconTile="amber"
          icon="hourglass-half"
        />
        <StatCard
          label="تجاوزت المدة"
          value="62"
          foot={{ icon: "circle-exclamation", text: "إجراء فوري" }}
          footTone="down"
          iconTile="red"
          icon="triangle-exclamation"
        />
      </div>

      <div className="mk-split">
        <Card padding={0} className="mk-card--flex">
          <div className="mk-card-hd">
            <div className="mk-card-hd__ico mk-card-hd__ico--blue"><Icon name="bolt" /></div>
            <div className="mk-card-hd__text">
              <h3>آخر المخالفات</h3>
              <p>آخر التحديثات والنشاط على التذاكر</p>
            </div>
            <button
              type="button"
              className="mk-link-all"
              onClick={() => app.setTab("workflow")}
            >
              عرض الكل <Icon name="arrow-left" style={{ fontSize: 10 }} />
            </button>
          </div>
          <div className="mk-card-bd">
            <RecentRow
              tone="info"   icon="file-lines"           title="مخالفة جديدة: خالد العتيبي"          desc="تأخير عن الدوام · فرع الرياض الرئيسي"  time="2026-04-12 · 09:14"  state="emp" />
            <RecentRow
              tone="warn"   icon="user-tie"             title="رفع للمشرف: نورة الزهراني"           desc="الإهمال في الزي الموحد · فرع جدة الشمالي" time="2026-04-12 · 08:02"  state="sup" />
            <RecentRow
              tone="info"   icon="clipboard-check"      title="بانتظار التدقيق: محمد القرني"        desc="غياب بدون إذن · فرع الدمام الصناعي"   time="2026-04-11 · 17:48"  state="aud" />
            <RecentRow
              tone="success" icon="check-double"        title="إغلاق: سعد المطيري"                   desc="تأخير عن الدوام · فرع مكة"             time="2026-04-10 · 14:05"  state="closed" />
          </div>
        </Card>

        <Card padding={0}>
          <div className="mk-card-hd mk-card-hd--stack">
            <h3>إجراءات سريعة</h3>
            <p>المهام والإجراءات الشائعة</p>
          </div>
          <div className="mk-card-bd mk-quick-grid">
            <button className="mk-quick" onClick={() => app.setTab("workflow")}>
              <i className="fas fa-ticket"></i><span>معالجة التذاكر</span>
            </button>
            <button className="mk-quick" onClick={() => app.setTab("newTicket")}>
              <i className="fas fa-circle-plus"></i><span>رصد مخالفة</span>
            </button>
            <button className="mk-quick" onClick={() => app.setTab("reports")}>
              <i className="fas fa-chart-bar"></i><span>التقارير</span>
            </button>
            <button className="mk-quick" onClick={() => app.setTab("compliance")}>
              <i className="fas fa-gauge-high"></i><span>مؤشرات الامتثال</span>
            </button>
          </div>
        </Card>
      </div>

      <Card padding={0}>
        <div className="mk-card-hd">
          <div className="mk-card-hd__ico mk-card-hd__ico--purple"><Icon name="chart-pie" /></div>
          <div className="mk-card-hd__text">
            <h3>توزيع الحالات</h3>
            <p>حسب مرحلة المعالجة — بيانات الشهر الحالي</p>
          </div>
        </div>
        <div className="mk-card-bd" style={{ paddingTop: 4 }}>
          <StateBar label="بانتظار الموظف"    count={112} max={400} tone="amber" />
          <StateBar label="بانتظار المشرف"    count={86}  max={400} tone="blue" />
          <StateBar label="بانتظار التدقيق"   count={48}  max={400} tone="purple" />
          <StateBar label="بانتظار الإدارة"   count={28}  max={400} tone="red" />
          <StateBar label="مغلقة"             count={398} max={400} tone="green" />
          <StateBar label="تنبيه إداري صادر"  count={61}  max={400} tone="amber" />
        </div>
      </Card>
    </div>
  );
}

window.Dashboard = Dashboard;
