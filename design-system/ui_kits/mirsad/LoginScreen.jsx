/* global React, Icon, Button */
const { useState } = React;

function LoginScreen({ onSignIn }) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="mk-login">
      <div className="mk-login__blobs" aria-hidden="true">
        <div className="mk-login__blob mk-login__blob--a"></div>
        <div className="mk-login__blob mk-login__blob--b"></div>
      </div>
      <div className="mk-login__center">
        <div className="mk-login__card">
          <header className="mk-login__hd">
            <div className="mk-login__ico"><Icon name="shield-halved" /></div>
            <h1 className="mk-login__title">
              مرصاد <Icon name="shield-halved" />
            </h1>
            <p className="mk-login__sub">منصة الرصد والامتثال المؤسسي</p>
          </header>
          <form
            className="mk-login__bd"
            onSubmit={(e) => { e.preventDefault(); onSignIn && onSignIn(); }}
          >
            <div className="mk-login__row">
              <label className="mk-login__lbl">البريد الإلكتروني</label>
              <div className="mk-login__field">
                <input className="mk-login__input" type="email" placeholder="name@example.com" defaultValue="rana@mirsad.sa" />
              </div>
            </div>
            <div className="mk-login__row">
              <label className="mk-login__lbl">كلمة المرور</label>
              <div className="mk-login__field">
                <input
                  className="mk-login__input mk-login__input--pw"
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••••"
                  defaultValue="passwd1234"
                />
                <button type="button" className="mk-login__pw" onClick={() => setShowPw((v) => !v)}>
                  <Icon name={showPw ? "eye-slash" : "eye"} />
                </button>
              </div>
            </div>
            <div className="mk-login__meta">
              <label><input type="checkbox" defaultChecked /> تذكّرني على هذا الجهاز</label>
              <a href="#" onClick={(e) => e.preventDefault()}>نسيت كلمة المرور؟</a>
            </div>
            <Button variant="primary" icon="arrow-left">دخول إلى لوحة الرصد</Button>
            <p className="mk-login__note">
              <Icon name="lock" /> بياناتك محمية بسياسة الامتثال الداخلي
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
