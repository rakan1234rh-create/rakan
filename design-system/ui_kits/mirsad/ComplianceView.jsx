/* global React, Icon, Badge, Card, Button, Num */

const REGIONS = [
  { name: "المنطقة الوسطى",  city: "الرياض", branches: 12, emps: 248, score: 92.4, trend: "up",   delta: "+2.1%" },
  { name: "المنطقة الغربية",  city: "جدة",    branches: 9,  emps: 184, score: 88.1, trend: "flat", delta: "0.0%" },
  { name: "المنطقة الشرقية",  city: "الدمام", branches: 7,  emps: 142, score: 74.6, trend: "down", delta: "-3.4%" },
  { name: "المنطقة الجنوبية", city: "أبها",   branches: 4,  emps: 86,  score: 81.2, trend: "up",   delta: "+0.8%" },
];

function TrendBadge({ trend, delta }) {
  const tone = trend === "up" ? "green" : trend === "down" ? "red" : "gray";
  const icon = trend === "up" ? "arrow-trend-up" : trend === "down" ? "arrow-trend-down" : "minus";
  return <Badge tone={tone} icon={icon}><span className="mk-num">{delta}</span></Badge>;
}

function ScoreRing({ value }) {
  const r = 28, c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  const color = value >= 90 ? "#16a34a" : value >= 75 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="#e4e6ef" strokeWidth="6" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="14" fontWeight="700" fill="#0f1224">
        {value.toFixed(0)}
      </text>
    </svg>
  );
}

function ComplianceView() {
  return (
    <div>
      <div className="mk-section-hd">
        <div>
          <h2 className="mk-section-hd__title">مؤشرات الامتثال</h2>
          <p className="mk-section-hd__sub">نظرة عامة على أداء كل منطقة وفروعها للشهر الحالي</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="secondary" icon="calendar">أبريل 2026</Button>
          <Button variant="primary" icon="file-export">تصدير PDF</Button>
        </div>
      </div>

      <div className="mk-cmp-grid">
        {REGIONS.map((r) => (
          <Card key={r.name} className="mk-cmp-card" padding={18}>
            <div className="mk-cmp-card__hd">
              <div className="mk-cmp-card__title">
                <Icon name="map-location-dot" style={{ color: "var(--mr-primary)" }} />
                <div>
                  <h3>{r.name}</h3>
                  <span className="mk-cmp-card__city">{r.city}</span>
                </div>
              </div>
              <TrendBadge trend={r.trend} delta={r.delta} />
            </div>
            <div className="mk-cmp-card__bd">
              <ScoreRing value={r.score} />
              <div className="mk-cmp-card__stats">
                <div className="mk-cmp-card__stat">
                  <span className="mk-cmp-card__stat-lbl">الفروع</span>
                  <span className="mk-cmp-card__stat-val mk-num">{r.branches}</span>
                </div>
                <div className="mk-cmp-card__stat">
                  <span className="mk-cmp-card__stat-lbl">الموظفون</span>
                  <span className="mk-cmp-card__stat-val mk-num">{r.emps}</span>
                </div>
                <div className="mk-cmp-card__stat">
                  <span className="mk-cmp-card__stat-lbl">معدّل الالتزام</span>
                  <span className="mk-cmp-card__stat-val mk-num">{r.score.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ComingSoon({ title, sub, icon = "wrench" }) {
  return (
    <Card>
      <div className="mk-cs">
        <div className="mk-cs__ico"><Icon name={icon} /></div>
        <h3>{title}</h3>
        <p>{sub}</p>
        <p style={{ marginTop: 12, fontFamily: "var(--mono)", fontSize: 11, color: "var(--mr-text-3)" }}>
          UI placeholder — see <code>_source/mirsad_index.html</code> for the canonical surface.
        </p>
      </div>
    </Card>
  );
}

window.ComplianceView = ComplianceView;
window.ComingSoon = ComingSoon;
