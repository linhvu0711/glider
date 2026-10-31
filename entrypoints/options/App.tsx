import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import iconUrl from '../../assets/icon.svg';
import iconDataUrl from '../../assets/icon.svg?inline';
import type { LoginConnection } from '../../lib/login/connection';
import type { LoginStep, LoginView } from '../../lib/login/state';
import type { Account, QrCode } from '../../lib/telegram/auth';
import { CheckIcon } from '../../components/icons';

function useLoginView(connection: LoginConnection | undefined): LoginView | null {
  const [view, setView] = useState<LoginView | null>(null);
  useEffect(() => {
    if (!connection) return;
    const unsubscribe = connection.subscribe(setView);
    connection.send({ type: 'hello' });
    return unsubscribe;
  }, [connection]);
  return view;
}

export default function App({ connection }: { connection?: LoginConnection }) {
  const view = useLoginView(connection);
  return (
    <div className="page">
      <header className="header">
        <img className="header-icon" src={iconUrl} alt="" width={36} height={36} />
        <h1 className="header-title">Glider</h1>
        <span className="header-sub">Settings</span>
        <span className="header-account">
          {view?.login.step === 'done' ? (
            <>
              <Avatar account={view.login.account} size={28} />
              {view.login.account.name}
            </>
          ) : (
            'Not logged in'
          )}
        </span>
      </header>
      {view && <LoginCard login={view.login} />}
      <footer className="footer">
        <span>
          Glider sends from your own Telegram account. Your login stays on this computer.
        </span>
      </footer>
    </div>
  );
}

function Avatar({ account, size }: { account: Account; size: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size >= 40 ? 15 : 12 }}
    >
      {account.initials}
    </span>
  );
}

function LoginCard({ login }: { login: LoginStep }) {
  const done = login.step === 'done';
  return (
    <section className="card" aria-labelledby="step-1-title">
      <div className="card-head">
        <span className={done ? 'badge badge-done' : 'badge'}>1</span>
        <h2 className="card-title" id="step-1-title">
          Log in to Telegram
        </h2>
        {done && (
          <span className="chip-done">
            <CheckIcon width={14} height={14} />
            <span>Done</span>
          </span>
        )}
      </div>
      {(login.step === 'checking' || login.step === 'qr') && (
        <QrStep code={login.step === 'qr' ? login.code : null} />
      )}
      {login.step === 'done' && (
        <div className="account-row">
          <Avatar account={login.account} size={40} />
          <div>
            <div className="account-name">{login.account.name}</div>
            <div className="muted">{`Shown in Telegram as "Glider · ${login.device}".`}</div>
          </div>
        </div>
      )}
    </section>
  );
}

function QrStep({ code }: { code: QrCode | null }) {
  return (
    <div className="qr-step">
      <div className="qr-box" role="group" aria-label="QR code">
        {code ? (
          <QRCodeSVG
            value={code.url}
            data-value={code.url}
            size={176}
            level="H"
            imageSettings={{ src: iconDataUrl, width: 40, height: 40, excavate: true }}
          />
        ) : (
          <div className="qr-loading">
            <span className="spinner" />
            <span className="muted">Getting a code…</span>
          </div>
        )}
      </div>
      <div className="qr-side">
        <ol className="qr-steps">
          <li>Open Telegram on your phone.</li>
          <li>
            Go to <strong>Settings → Devices → Link Desktop Device</strong>.
          </li>
          <li>Point your phone at this code.</li>
        </ol>
        {code && <Countdown expires={code.expires} />}
        <button type="button" className="link">
          Log in with phone number instead
        </button>
      </div>
    </div>
  );
}

function Countdown({ expires }: { expires: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expires]);
  const seconds = Math.max(0, Math.ceil((expires - now) / 1000));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <p className="muted countdown">New code in {text}</p>;
}
