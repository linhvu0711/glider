import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import iconUrl from '../../assets/icon.svg';
import iconDataUrl from '../../assets/icon.svg?inline';
import type { LoginConnection } from '../../lib/login/connection';
import type { LoginCommand, LoginStep, LoginView } from '../../lib/login/state';
import { checkPhone } from '../../lib/phone';
import type { Account, QrCode } from '../../lib/telegram/auth';
import type { Chat, ChatId, ChatKind, TelegramChats } from '../../lib/telegram/chats';
import {
  AlertIcon,
  BookmarkIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  SearchIcon,
} from '../../components/icons';

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

export default function App({
  connection,
  chats,
}: {
  connection?: LoginConnection;
  chats?: TelegramChats;
}) {
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
              <span>{view.login.account.name}</span>
            </>
          ) : (
            <span>Not logged in</span>
          )}
        </span>
      </header>
      {view && connection && (
        <>
          {view.notice && <LoggedOutBanner send={connection.send} />}
          <LoginCard login={view.login} send={connection.send} />
          {chats && <TargetCard loggedIn={view.login.step === 'done'} chats={chats} />}
        </>
      )}
      <footer className="footer">
        <span>
          Glider sends from your own Telegram account. Your login stays on this computer.
        </span>
        {view?.login.step === 'done' && connection && (
          <LogOut logout={view.login.logout} send={connection.send} />
        )}
      </footer>
    </div>
  );
}

function LogOut({ logout, send }: { logout: 'idle' | 'busy' | 'offline'; send: Send }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link link-red" onClick={() => setOpen(true)}>
        Log out
      </button>
      {open && (
        <LogoutDialog
          logout={logout}
          onCancel={() => setOpen(false)}
          onConfirm={() => send({ type: 'logOut' })}
        />
      )}
    </>
  );
}

function LogoutDialog({
  logout,
  onCancel,
  onConfirm,
}: {
  logout: 'idle' | 'busy' | 'offline';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus();
  }, []);
  const busy = logout === 'busy';
  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="logout-title"
      onClose={onCancel}
      // The browser closes a modal dialog on Esc by itself; happy-dom does not, so tests need this.
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
    >
      <h2 className="dialog-title" id="logout-title">
        Log out of Glider?
      </h2>
      <p className="dialog-text">
        This also ends Glider&apos;s session in Telegram. Links that wait to send are not sent.
        You can log in again any time.
      </p>
      {logout === 'offline' && <p className="error">Telegram can&apos;t be reached. Try again.</p>}
      <div className="dialog-buttons">
        <button type="button" ref={cancel} className="button-plain" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-red" disabled={busy} onClick={onConfirm}>
          {busy ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </dialog>
  );
}

function LoggedOutBanner({ send }: { send: Send }) {
  return (
    <div className="card banner" role="status">
      <AlertIcon className="banner-icon" width={20} height={20} />
      <span className="banner-text">You were logged out.</span>
      <button
        type="button"
        className="link"
        onClick={() => {
          send({ type: 'dismissNotice' });
          send({ type: 'newQr' });
        }}
      >
        Log in again
      </button>
    </div>
  );
}

function Avatar({ account, size }: { account: Account; size: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size >= 40 ? 15 : 12 }}
    >
      <span>{account.initials}</span>
    </span>
  );
}

type Send = (command: LoginCommand) => void;

function LoginCard({ login, send }: { login: LoginStep; send: Send }) {
  const done = login.step === 'done';
  const [draft, setDraft] = useState({ country: '+84', number: '' });
  return (
    <section className="card" aria-labelledby="step-1-title">
      <div className="card-head">
        <span className={done ? 'badge badge-done' : 'badge'}>
          <span>1</span>
        </span>
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
      {login.step === 'checking' && <QrStep checking code={null} send={send} />}
      {login.step === 'qr' && <QrStep code={login.code} expired={login.expired} send={send} />}
      {login.step === 'phone' && (
        <PhoneStep
          draft={draft}
          onDraft={setDraft}
          busy={login.busy}
          serverError={login.error}
          send={send}
        />
      )}
      {login.step === 'code' && <CodeStep login={login} send={send} />}
      {login.step === 'password' && <PasswordStep login={login} send={send} />}
      {login.step === 'offline' && (
        <div className="offline">
          <AlertIcon className="offline-icon" width={20} height={20} />
          <p className="offline-text">
            Telegram can&apos;t be reached. Check your internet connection.
          </p>
          <button type="button" className="button" onClick={() => send({ type: 'retry' })}>
            Try again
          </button>
        </div>
      )}
      {login.step === 'done' && (
        <div className="account-row">
          <Avatar account={login.account} size={40} />
          <div className="account-text">
            <div className="account-name">{login.account.name}</div>
            <div className="muted">{`Shown in Telegram as "Glider · ${login.device}".`}</div>
          </div>
        </div>
      )}
    </section>
  );
}

function QrStep({
  code,
  checking = false,
  expired = false,
  send,
}: {
  code: QrCode | null;
  checking?: boolean;
  expired?: boolean;
  send: Send;
}) {
  return (
    <div className="qr-step">
      <div className="qr-box" role="group" aria-label="QR code">
        {expired ? (
          <div className="qr-loading">
            <p className="qr-expired">This code expired.</p>
            <button type="button" className="button" onClick={() => send({ type: 'newQr' })}>
              Get a new code
            </button>
          </div>
        ) : code ? (
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
            <span className="muted">{checking ? 'Checking your login…' : 'Getting a code…'}</span>
          </div>
        )}
      </div>
      {!checking && (
      <div className="qr-side">
        <ol className="qr-steps">
          <li>Open Telegram on your phone.</li>
          <li>
            Go to <strong>Settings → Devices → Link Desktop Device</strong>.
          </li>
          <li>Point your phone at this code.</li>
        </ol>
        {code && !expired && <Countdown expires={code.expires} />}
        <button type="button" className="link" onClick={() => send({ type: 'usePhone' })}>
          Log in with phone number instead
        </button>
      </div>
      )}
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

function PhoneStep({
  draft,
  onDraft,
  busy,
  serverError,
  send,
}: {
  draft: { country: string; number: string };
  onDraft: (draft: { country: string; number: string }) => void;
  busy: boolean;
  serverError: 'bad-phone' | null;
  send: Send;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const error =
    localError ??
    (serverError === 'bad-phone'
      ? 'Telegram does not know this number. Check it and try again.'
      : null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = checkPhone(draft.country, draft.number);
    if (!result.ok) return setLocalError(result.error);
    setLocalError(null);
    send({ type: 'sendCode', phone: result.phone });
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="label" htmlFor="phone-number">
        Phone number
      </label>
      <div className="phone-row">
        <input
          className="input input-country"
          aria-label="Country code"
          value={draft.country}
          onChange={(e) => onDraft({ ...draft, country: e.target.value })}
        />
        <input
          id="phone-number"
          className="input input-grow"
          aria-label="Phone number"
          placeholder="912 345 678"
          inputMode="tel"
          autoFocus
          value={draft.number}
          onChange={(e) => onDraft({ ...draft, number: e.target.value })}
        />
      </div>
      <p className="muted">Enter your full phone number, like 912 345 678.</p>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
      <button type="button" className="link" onClick={() => send({ type: 'useQr' })}>
        Use QR code instead
      </button>
    </form>
  );
}

type CodeLogin = Extract<LoginStep, { step: 'code' }>;

function CodeStep({ login, send }: { login: CodeLogin; send: Send }) {
  const { length, busy, error } = login;
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(''));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (error) {
      setDigits(Array(length).fill(''));
      boxes.current[0]?.focus();
    }
  }, [error, length]);

  function fill(next: string[]) {
    setDigits(next);
    if (next.every((d) => d !== '')) send({ type: 'submitCode', code: next.join('') });
  }

  function onChange(index: number, value: string) {
    const entered = value.replace(/\D/g, '').slice(-1);
    const next = digits.map((d, i) => (i === index ? entered : d));
    if (entered && index < length - 1) boxes.current[index + 1]?.focus();
    fill(next);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && digits[index] === '' && index > 0) {
      event.preventDefault();
      setDigits(digits.map((d, i) => (i === index - 1 ? '' : d)));
      boxes.current[index - 1]?.focus();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    const next = digits.map((_, i) => pasted[i] ?? '');
    boxes.current[Math.min(pasted.length, length - 1)]?.focus();
    fill(next);
  }

  const full = digits.every((d) => d !== '');

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (full && !busy) send({ type: 'submitCode', code: digits.join('') });
      }}
    >
      <p className="prompt">Enter the code sent to your Telegram app</p>
      <p className="muted">{`Sent to +${login.phone}.`}</p>
      <div className="code-row">
        {digits.map((value, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            className="input code-box"
            aria-label={`Digit ${i + 1}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus={i === 0}
            value={value}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
          />
        ))}
      </div>
      {error === 'wrong' && (
        <p className="error">
          That code is wrong. Check the newest message from Telegram and try again.
        </p>
      )}
      {error === 'expired' && (
        <>
          <p className="error">That code expired.</p>
          <button type="button" className="button" onClick={() => send({ type: 'resendCode' })}>
            Send a new code
          </button>
        </>
      )}
      <button type="submit" className="button" disabled={!full || busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <div className="links">
        <button type="button" className="link" onClick={() => send({ type: 'changeNumber' })}>
          Change number
        </button>
        <button type="button" className="link" onClick={() => send({ type: 'useQr' })}>
          Use QR code instead
        </button>
      </div>
    </form>
  );
}

function PasswordStep({
  login,
  send,
}: {
  login: Extract<LoginStep, { step: 'password' }>;
  send: Send;
}) {
  const { busy, error } = login;
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) {
      setPassword('');
      input.current?.focus();
    }
  }, [error]);

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== '' && !busy) send({ type: 'submitPassword', password });
      }}
    >
      <p className="prompt">Your account has a 2-step password. Enter it to finish.</p>
      <div className="password-field">
        <input
          ref={input}
          className="input password-input"
          aria-label="2-step password"
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="button"
          className="eye"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error === 'wrong' && <p className="error">That password is wrong. Try again.</p>}
      <button type="submit" className="button" disabled={password === '' || busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <button type="button" className="link" onClick={() => send({ type: 'useQr' })}>
        Use QR code instead
      </button>
    </form>
  );
}

// Picked by id, so a chat keeps its color in every list (mockup frame 1).
const AVATAR_COLORS = ['#2563eb', '#db2777', '#059669', '#b45309', '#7c3aed', '#0891b2', '#dc2626'];

const MAX_ROWS = 20;

const TAGS: Record<ChatKind, string> = {
  self: 'You',
  person: 'Person',
  bot: 'Bot',
  group: 'Group',
  channel: 'Channel',
};

function TargetCard({ loggedIn, chats }: { loggedIn: boolean; chats: TelegramChats }) {
  const [list, setList] = useState<Chat[] | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    let live = true;
    void chats.list().then((next) => {
      if (live) setList(next);
    });
    return () => {
      live = false;
    };
  }, [loggedIn, chats]);

  return (
    <section
      className={loggedIn ? 'card' : 'card card-off'}
      aria-labelledby="step-2-title"
      aria-disabled={loggedIn ? undefined : 'true'}
      inert={!loggedIn}
    >
      <div className="card-head">
        <span className="badge">
          <span>2</span>
        </span>
        <h2 className="card-title" id="step-2-title">
          Choose the chat
        </h2>
      </div>
      <p className="muted card-line">
        Links go to this one chat, sent by you. You can change it any time.
      </p>
      {loggedIn && (
        <>
          <div className="search-field">
            <SearchIcon className="search-icon" />
            <input
              className="input search-input"
              type="search"
              placeholder="Search your chats"
              aria-label="Search your chats"
            />
          </div>
          <h3 className="list-title" id="chat-list-title">
            Recent chats
          </h3>
          <div className="chat-list" role="radiogroup" aria-labelledby="chat-list-title">
            {list?.slice(0, MAX_ROWS).map((chat) => (
              <ChatRow key={chat.id} chat={chat} chats={chats} />
            ))}
          </div>
          <div className="save-row">
            <button type="button" className="button button-save" disabled>
              Save
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ChatRow({ chat, chats }: { chat: Chat; chats: TelegramChats }) {
  return (
    <label className="chat-row">
      <input type="radio" name="target-chat" aria-label={chat.name} />
      <ChatAvatar chat={chat} chats={chats} />
      <span className="chat-text">
        <span className="chat-name">{chat.name}</span>
        <span className="muted">{chat.detail}</span>
      </span>
      <span className="chat-tag">{TAGS[chat.kind]}</span>
    </label>
  );
}

function ChatAvatar({ chat, chats }: { chat: Chat; chats: TelegramChats }) {
  const photo = usePhoto(chat, chats);
  if (chat.kind === 'self') {
    return (
      <span className="avatar chat-avatar" style={{ background: 'var(--accent)' }}>
        <BookmarkIcon width={16} height={16} />
      </span>
    );
  }
  if (photo) return <img className="avatar-photo" alt="" src={photo} />;
  return (
    <span
      className="avatar chat-avatar"
      style={{ background: AVATAR_COLORS[Math.abs(chat.id) % AVATAR_COLORS.length] }}
    >
      <span>{chat.initials}</span>
    </span>
  );
}

// One ask per chat for the life of the page.
const photoAsks = new WeakMap<TelegramChats, Map<ChatId, Promise<string | null>>>();

function usePhoto(chat: Chat, chats: TelegramChats): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!chat.hasPhoto) return;
    let live = true;
    let asks = photoAsks.get(chats);
    if (!asks) {
      asks = new Map();
      photoAsks.set(chats, asks);
    }
    let ask = asks.get(chat.id);
    if (!ask) {
      ask = chats.photo(chat.id);
      asks.set(chat.id, ask);
    }
    void ask.then((url) => {
      if (live) setPhoto(url);
    });
    return () => {
      live = false;
    };
  }, [chat.id, chat.hasPhoto, chats]);
  return photo;
}
