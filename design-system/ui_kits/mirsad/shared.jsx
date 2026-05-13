/* global React */
const { useState, useEffect, useRef, createContext, useContext } = React;

/* ──────────────────────────────────────────────────────────────────────
   Shared atoms — match Mirsad's --mr-* token vocabulary
   ────────────────────────────────────────────────────────────────────── */

const Icon = ({ name, ...rest }) => (
  <i className={`fas fa-${name}`} aria-hidden="true" {...rest}></i>
);

const Badge = ({ tone = "gray", icon, children, style }) => (
  <span className={`mk-badge mk-badge--${tone}`} style={style}>
    {icon ? <Icon name={icon} /> : null}
    {children}
  </span>
);

const Button = ({
  variant = "secondary",
  size = "md",
  icon,
  iconEnd,
  children,
  onClick,
  disabled,
  style,
}) => (
  <button
    className={`mk-btn mk-btn--${variant} ${size === "sm" ? "mk-btn--sm" : ""}`}
    onClick={onClick}
    disabled={disabled}
    style={style}
  >
    {icon ? <Icon name={icon} /> : null}
    {children}
    {iconEnd ? <Icon name={iconEnd} /> : null}
  </button>
);

const Card = ({ children, className = "", style, padding = 22 }) => (
  <section
    className={`mk-card ${className}`}
    style={{ padding, ...(style || {}) }}
  >
    {children}
  </section>
);

const SearchPill = ({ placeholder, value, onChange, wide, autoFocus }) => (
  <div className={`mk-search ${wide ? "mk-search--wide" : ""}`}>
    <Icon name="magnifying-glass" style={{ color: "var(--mr-text-3)", fontSize: 13 }} />
    <input
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
      autoFocus={autoFocus}
    />
    <button className="mk-search__btn" aria-label="search">
      <Icon name="arrow-left" style={{ fontSize: 11 }} />
    </button>
  </div>
);

const Num = ({ children, className = "", ...rest }) => (
  <span className={`mk-num ${className}`} {...rest}>
    {children}
  </span>
);

/* ──────────────────────────────────────────────────────────────────────
   App context — shared across screens for the click-through demo
   ────────────────────────────────────────────────────────────────────── */

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

/* Sample ticket data, mirroring the source app's state vocabulary */
const SAMPLE_TICKETS = [
  { id: "TKT-0024891", emp: "خالد العتيبي",  num: "EMP-1042", type: "تأخير عن الدوام",        branch: "فرع الرياض الرئيسي",   state: "emp",    date: "2026-04-12 · 09:14", days: 2 },
  { id: "TKT-0024890", emp: "نورة الزهراني", num: "EMP-1009", type: "الإهمال في الزي الموحد", branch: "فرع جدة الشمالي",      state: "sup",    date: "2026-04-12 · 08:02", days: 4 },
  { id: "TKT-0024888", emp: "محمد القرني",   num: "EMP-2210", type: "غياب بدون إذن",          branch: "فرع الدمام الصناعي",   state: "aud",    date: "2026-04-11 · 17:48", days: 1 },
  { id: "TKT-0024885", emp: "ريم الفهد",     num: "EMP-3001", type: "إفشاء معلومات داخلية",   branch: "فرع الرياض الرئيسي",   state: "mgt",    date: "2026-04-11 · 11:30", days: 0 },
  { id: "TKT-0024881", emp: "سعد المطيري",   num: "EMP-2244", type: "تأخير عن الدوام",        branch: "فرع مكة",              state: "closed", date: "2026-04-10 · 14:05", days: null },
  { id: "TKT-0024879", emp: "أمل الشمري",    num: "EMP-1801", type: "مخالفة سياسة سلامة",     branch: "فرع جدة الشمالي",      state: "warn",   date: "2026-04-10 · 12:22", days: null },
  { id: "TKT-0024877", emp: "تركي الدوسري", num: "EMP-2065", type: "غياب بدون إذن",          branch: "فرع الدمام الصناعي",   state: "sup",    date: "2026-04-09 · 16:11", days: 3 },
  { id: "TKT-0024874", emp: "هند الحربي",    num: "EMP-3344", type: "تأخير عن الدوام",        branch: "فرع الرياض الرئيسي",   state: "emp",    date: "2026-04-09 · 08:38", days: 5 },
];

const STATE_LABELS = {
  emp:    { label: "بانتظار الموظف",     tone: "amber",  icon: "user-clock" },
  sup:    { label: "بانتظار المشرف",     tone: "blue",   icon: "user-tie" },
  aud:    { label: "بانتظار التدقيق",     tone: "purple", icon: "clipboard-check" },
  mgt:    { label: "بانتظار الإدارة",     tone: "red",    icon: "gavel" },
  closed: { label: "مغلقة",               tone: "green",  icon: "check-double" },
  warn:   { label: "تنبيه إداري صادر",    tone: "amber",  icon: "bell" },
};

/* Expose to other Babel files */
Object.assign(window, {
  Icon, Badge, Button, Card, SearchPill, Num,
  AppCtx, useApp,
  SAMPLE_TICKETS, STATE_LABELS,
});
