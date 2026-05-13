/* global React, Icon, Badge, Button, Card, SearchPill, Num, SAMPLE_TICKETS, STATE_LABELS */
const { useState } = React;

const FILTERS = [
  { id: "all",    label: "كل التذاكر" },
  { id: "emp",    label: "بانتظار الموظف" },
  { id: "sup",    label: "بانتظار المشرف" },
  { id: "aud",    label: "بانتظار التدقيق" },
  { id: "mgt",    label: "بانتظار الإدارة" },
  { id: "closed", label: "مغلقة" },
];

function TicketModal({ ticket, onClose }) {
  if (!ticket) return null;
  const s = STATE_LABELS[ticket.state] || {};
  return (
    <div className="mk-modal-overlay" onClick={onClose}>
      <div className="mk-modal" onClick={(e) => e.stopPropagation()}>
        <header className="mk-modal__hd">
          <div>
            <div className="mk-modal__id mk-num">{ticket.id}</div>
            <h3 className="mk-modal__title">{ticket.type}</h3>
          </div>
          <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>
          <button className="mk-iconbtn mk-iconbtn--ghost" onClick={onClose} aria-label="إغلاق">
            <Icon name="xmark" />
          </button>
        </header>
        <div className="mk-modal__bd">
          <div className="mk-kv">
            <div className="mk-kv__row"><span className="mk-kv__k">الموظف</span><span className="mk-kv__v">{ticket.emp} <span className="mk-num" style={{color:"var(--mr-text-3)"}}>· {ticket.num}</span></span></div>
            <div className="mk-kv__row"><span className="mk-kv__k">الفرع</span><span className="mk-kv__v">{ticket.branch}</span></div>
            <div className="mk-kv__row"><span className="mk-kv__k">تاريخ المخالفة</span><span className="mk-kv__v mk-num">{ticket.date}</span></div>
            <div className="mk-kv__row"><span className="mk-kv__k">المدة المتبقية</span><span className="mk-kv__v">{ticket.days != null ? (<><span className="mk-num">{ticket.days}</span> {ticket.days === 1 ? "يوم" : "أيام"}</>) : <span style={{color:"var(--mr-text-3)"}}>—</span>}</span></div>
          </div>

          <div className="mk-section-title">سير الإجراء</div>
          <div className="mk-stepper">
            {["emp", "sup", "aud", "mgt", "closed"].map((st, i) => {
              const lbl = STATE_LABELS[st];
              const stIdx = ["emp", "sup", "aud", "mgt", "closed"].indexOf(ticket.state);
              const stateMode = stIdx === -1 ? (ticket.state === "warn" ? 4 : 5) : stIdx;
              const isDone = i < stateMode || ticket.state === "closed";
              const isCurrent = i === stateMode && ticket.state !== "closed" && ticket.state !== "warn";
              return (
                <div key={st} className={`mk-step ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`}>
                  <div className="mk-step__dot"><Icon name={isDone ? "check" : lbl.icon} /></div>
                  <div className="mk-step__lbl">{lbl.label}</div>
                </div>
              );
            })}
          </div>
        </div>
        <footer className="mk-modal__ft">
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="secondary" icon="rotate-left">إرجاع للموظف</Button>
          <Button variant="danger" icon="ban">رفض</Button>
          <Button variant="primary" icon="check-double">اعتماد ورفع للتدقيق</Button>
        </footer>
      </div>
    </div>
  );
}

function WorkflowTable() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);

  const visible = SAMPLE_TICKETS.filter((t) => {
    if (filter !== "all" && t.state !== filter) return false;
    if (search.trim()) {
      const q = search.trim();
      if (![t.id, t.emp, t.num, t.type, t.branch].some((v) => v.includes(q))) return false;
    }
    return true;
  });

  return (
    <Card padding={0} className="mk-wf-panel">
      <div className="mk-wf-hd">
        <div>
          <h2 className="mk-wf-title">معالجة التذاكر</h2>
          <p className="mk-wf-sub mk-num">{visible.length} / {SAMPLE_TICKETS.length} tickets</p>
        </div>
        <Button variant="primary" icon="circle-plus">رصد مخالفة جديدة</Button>
      </div>

      <div className="mk-wf-toolbar">
        <SearchPill
          placeholder="ابحث برقم التذكرة، اسم الموظف، أو الفرع..."
          value={search}
          onChange={setSearch}
          wide
        />
        <Button variant="secondary" icon="sliders">فرز بواسطة <Num>2</Num></Button>
        <Button variant="secondary" icon="calendar">آخر 30 يوم</Button>
      </div>

      <div className="mk-wf-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`mk-chip ${filter === f.id ? "is-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mk-wf-table-wrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الموظف</th>
              <th>نوع المخالفة</th>
              <th>الفرع</th>
              <th>تاريخ المخالفة</th>
              <th>الحالة</th>
              <th>المدة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const s = STATE_LABELS[t.state] || {};
              return (
                <tr key={t.id} onClick={() => setOpen(t)}>
                  <td className="mk-num">{t.id}</td>
                  <td>
                    <div className="mk-emp">
                      <div className="mk-emp__av">{t.emp.slice(0, 1)}</div>
                      <div>
                        <div className="mk-emp__name">{t.emp}</div>
                        <div className="mk-emp__num mk-num">{t.num}</div>
                      </div>
                    </div>
                  </td>
                  <td>{t.type}</td>
                  <td><span style={{color:"var(--mr-text-2)"}}>{t.branch}</span></td>
                  <td className="mk-num">{t.date}</td>
                  <td><Badge tone={s.tone} icon={s.icon}>{s.label}</Badge></td>
                  <td className="mk-num">
                    {t.days != null
                      ? <span style={{color: t.days <= 1 ? "var(--mr-danger)" : "var(--mr-text-2)"}}>{t.days}d</span>
                      : <span style={{color:"var(--mr-text-3)"}}>—</span>}
                  </td>
                  <td><button className="mk-iconbtn mk-iconbtn--xs" aria-label="فتح"><Icon name="arrow-left" /></button></td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="mk-empty">
                  <Icon name="folder-open" /><p>لا توجد تذاكر تطابق الفلتر الحالي</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TicketModal ticket={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

window.WorkflowTable = WorkflowTable;
