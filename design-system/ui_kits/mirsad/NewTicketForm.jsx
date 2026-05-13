/* global React, Icon, Card, Button, Badge */
const { useState } = React;

function FormRow({ label, required, children, hint, error }) {
  return (
    <div className="mk-field">
      <label className="mk-field__lbl">
        {label}{required ? <span className="mk-req">*</span> : null}
      </label>
      {children}
      {error ? <div className="mk-field__hint mk-field__hint--err">{error}</div>
             : hint ? <div className="mk-field__hint">{hint}</div> : null}
    </div>
  );
}

function NewTicketForm() {
  const [emp, setEmp] = useState("نورة الزهراني");
  const [vt, setVt] = useState("تأخير عن الدوام");

  return (
    <Card padding={0} className="mk-form-panel">
      <header className="mk-form-hd">
        <div>
          <h2>رصد مخالفة جديدة</h2>
          <p>سجّل مخالفة بأكبر قدر من التفاصيل وأرفق المستندات الداعمة</p>
        </div>
        <Badge tone="amber" icon="bell">سيتم إخطار المشرف فور الإرسال</Badge>
      </header>

      <div className="mk-form-grid">
        <FormRow label="الموظف المخالف" required hint="ابحث بالاسم، رقم الموظف، أو الجوال">
          <div className="mk-input-wrap">
            <input
              className="mk-input"
              value={emp}
              onChange={(e) => setEmp(e.target.value)}
              placeholder="مثال: خالد العتيبي"
            />
            <Icon name="magnifying-glass" />
          </div>
        </FormRow>

        <FormRow label="نوع المخالفة" required>
          <select className="mk-input" value={vt} onChange={(e) => setVt(e.target.value)}>
            <option>تأخير عن الدوام</option>
            <option>غياب بدون إذن</option>
            <option>الإهمال في الزي الموحد</option>
            <option>إفشاء معلومات داخلية</option>
            <option>مخالفة سياسة سلامة</option>
          </select>
        </FormRow>

        <FormRow label="تاريخ المخالفة" required>
          <input className="mk-input mk-num" type="date" defaultValue="2026-04-12" />
        </FormRow>

        <FormRow label="وقت المخالفة" required>
          <input className="mk-input mk-num" type="time" defaultValue="09:14" />
        </FormRow>

        <FormRow label="الفرع / الموقع" required>
          <select className="mk-input">
            <option>فرع الرياض الرئيسي</option>
            <option>فرع جدة الشمالي</option>
            <option>فرع الدمام الصناعي</option>
            <option>فرع مكة</option>
          </select>
        </FormRow>

        <FormRow label="الخطورة" hint="يحدد وزن المخالفة في التقييم">
          <div className="mk-seg">
            <button className="mk-seg__opt">منخفضة</button>
            <button className="mk-seg__opt is-active">متوسطة</button>
            <button className="mk-seg__opt">عالية</button>
          </div>
        </FormRow>

        <FormRow label="الوصف التفصيلي" hint="اذكر السياق والشهود والأثر المتوقع" required>
          <textarea
            className="mk-input mk-input--ta"
            rows="4"
            placeholder="مثال: تأخر الموظف عن بداية الدوام بـ 45 دقيقة دون إخطار مسبق، وتم رصد ذلك عبر نظام الحضور..."
            defaultValue="تأخر الموظف عن بداية الدوام بـ 45 دقيقة دون إخطار مسبق، وتم رصد ذلك عبر نظام الحضور الرقمي."
          ></textarea>
        </FormRow>

        <FormRow label="المرفقات / الأدلة" hint="PDF، صور، أو ملفات نصية حتى 10MB">
          <div className="mk-drop">
            <Icon name="cloud-arrow-up" />
            <div className="mk-drop__txt">
              <strong>اسحب الملفات هنا</strong>
              <span>أو اضغط للاختيار من جهازك</span>
            </div>
          </div>
        </FormRow>
      </div>

      <footer className="mk-form-ft">
        <Button variant="ghost">إلغاء</Button>
        <Button variant="secondary" icon="floppy-disk">حفظ كمسودة</Button>
        <Button variant="primary" icon="paper-plane">إرسال إلى المشرف</Button>
      </footer>
    </Card>
  );
}

window.NewTicketForm = NewTicketForm;
