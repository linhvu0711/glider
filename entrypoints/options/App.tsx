import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import iconUrl from '../../assets/icon.svg';
import iconDataUrl from '../../assets/icon.svg?inline';
import type { LoginConnection } from '../../lib/login/connection';
import type { LoginCommand, LoginStep, LoginView } from '../../lib/login/state';
import { checkPhone } from '../../lib/phone';
import type { Account, QrCode } from '../../lib/telegram/auth';
import type { Chat, ChatId, ChatKind, TelegramChats } from '../../lib/telegram/chats';
import { targetChat, targetChatFor, type TargetChat } from '../../lib/target-chat';
import { browser } from 'wxt/browser';
import { ChatAvatar } from '../../components/chat-avatar';
import { ShortcutKeys } from '../../components/shortcut-keys';
import {
  AlertIcon,
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

// The account step 2 works for. A session check (another tab's hello) is not a log out,
// so the account stays through `checking`.
function useChatAccount(login: LoginStep | undefined): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  const next =
    login?.step === 'done' ? login.account : login?.step === 'checking' ? account : null;
  if (next !== account) setAccount(next);
  return next;
}

export default function App({
  connection,
  chats,
}: {
  connection?: LoginConnection;
  chats?: TelegramChats;
}) {
  const view = useLoginView(connection);
  const chatAccount = useChatAccount(view?.login);
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
          {chats && (
            // A new key per account: no list, pick, or search stays from the last account.
            <TargetCard key={chatAccount?.id ?? 'none'} account={chatAccount} chats={chats} />
          )}
          <SendFasterCard />
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

const MAX_ROWS = 20;

const TAGS: Record<ChatKind, string> = {
  self: 'You',
  person: 'Person',
  bot: 'Bot',
  group: 'Group',
  channel: 'Channel',
};

type ChatsState = { state: 'loading' } | { state: 'ready'; chats: Chat[] } | { state: 'error' };

const PLACEHOLDER_ROWS = 5;

function useChatList(loggedIn: boolean, chats: TelegramChats) {
  const [list, setList] = useState<ChatsState>({ state: 'loading' });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!loggedIn) return;
    let live = true;
    setList({ state: 'loading' });
    chats.list().then(
      (next) => {
        if (live) setList({ state: 'ready', chats: next });
      },
      () => {
        if (live) setList({ state: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, [loggedIn, chats, tries]);

  return { list, retry: () => setTries((n) => n + 1) };
}

function matches(chat: Chat, query: string): boolean {
  const text = query.replace(/^@/, '');
  return (
    chat.name.toLowerCase().includes(text) || (chat.username ?? '').toLowerCase().includes(text)
  );
}

const TOAST_MS = 4_000;

function useTargetChat(account: Account | null): Chat | null | undefined {
  const [saved, setSaved] = useState<TargetChat | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void targetChat.getValue().then((value) => {
      if (live) setSaved(value);
    });
    const unwatch = targetChat.watch((value) => setSaved(value));
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  if (saved === undefined) return undefined;
  return account ? targetChatFor(saved, account.id) : null;
}

function TargetCard({ account, chats }: { account: Account | null; chats: TelegramChats }) {
  const loggedIn = account !== null;
  const { list, retry } = useChatList(loggedIn, chats);
  const card = useRef<HTMLElement>(null);
  // The popup's Pick another chat opens this page at #chat.
  useEffect(() => {
    if (location.hash === '#chat') card.current?.scrollIntoView({ block: 'start' });
  }, []);
  const saved = useTargetChat(account);
  const [picked, setPicked] = useState<ChatId | null>(null);
  // The saved chat moves to the top once per load, never under the pointer at Save.
  const [pinned, setPinned] = useState<Chat | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const savedKnown = saved !== undefined;

  useEffect(() => {
    if (saved) setPicked((current) => current ?? saved.id);
  }, [saved]);

  useEffect(() => {
    if (list.state === 'ready' && savedKnown) setPinned(saved ?? null);
    // Only a new load moves the saved chat; a Save after it does not.
  }, [list, savedKnown]);

  useEffect(() => {
    if (toast === null) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const loaded = list.state === 'ready' ? list.chats : [];
  const ordered = pinned
    ? [loaded.find((chat) => chat.id === pinned.id) ?? pinned, ...loaded.filter((chat) => chat.id !== pinned.id)]
    : loaded;
  const typed = query.trim();
  const searching = typed !== '';
  const shown = ordered
    .filter((chat) => !searching || matches(chat, typed.toLowerCase()))
    .slice(0, MAX_ROWS);
  const pickedChat =
    ordered.find((chat) => chat.id === picked) ?? (saved && saved.id === picked ? saved : null);
  const done = loggedIn && !!saved;
  const changed = pickedChat !== null && pickedChat.id !== saved?.id;

  async function save() {
    if (!account || !pickedChat) return;
    await targetChat.setValue({ account: account.id, chat: pickedChat });
    setToast(`Saved. Links now go to ${pickedChat.name}.`);
  }

  return (
    <section
      ref={card}
      className={loggedIn ? 'card' : 'card card-off'}
      aria-labelledby="step-2-title"
      aria-disabled={loggedIn ? undefined : 'true'}
      inert={!loggedIn}
    >
      <div className="card-head">
        <span className={done ? 'badge badge-done' : 'badge'}>
          <span>2</span>
        </span>
        <h2 className="card-title" id="step-2-title">
          Choose the chat
        </h2>
        {done && (
          <span className="chip-done">
            <CheckIcon width={14} height={14} />
            <span>Done</span>
          </span>
        )}
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <h3 className="list-title" id="chat-list-title">
            {searching ? 'Results' : 'Recent chats'}
          </h3>
          {list.state === 'error' ? (
            <div className="offline chat-error">
              <AlertIcon className="offline-icon" width={20} height={20} />
              <p className="offline-text">Could not load your chats. Check your internet.</p>
              <button type="button" className="button" onClick={retry}>
                Try again
              </button>
            </div>
          ) : list.state === 'ready' && shown.length === 0 ? (
            <p className="muted empty">
              {`No chat named "${typed}". Check the spelling, or open the chat in Telegram once so it shows here.`}
            </p>
          ) : (
            <div
              className="chat-list"
              role="radiogroup"
              aria-labelledby="chat-list-title"
              aria-busy={list.state === 'loading' ? 'true' : undefined}
            >
              {list.state === 'loading'
                ? Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
                    <div
                      key={i}
                      className="chat-row chat-placeholder"
                      data-testid="chat-placeholder"
                      aria-hidden="true"
                    >
                      <span className="placeholder-circle" />
                      <span className="chat-text">
                        <span className="placeholder-bar placeholder-bar-long" />
                        <span className="placeholder-bar" />
                      </span>
                    </div>
                  ))
                : shown.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      chats={chats}
                      current={chat.id === saved?.id}
                      checked={chat.id === picked}
                      onPick={() => setPicked(chat.id)}
                    />
                  ))}
            </div>
          )}
          <div className="save-row">
            <button
              type="button"
              className="button button-save"
              disabled={!changed}
              onClick={() => void save()}
            >
              Save
            </button>
            {pickedChat && (
              <span className="muted">
                {changed
                  ? `Links will go to ${pickedChat.name}.`
                  : `Links go to ${pickedChat.name}.`}
              </span>
            )}
          </div>
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}

// Nothing to do here, so the step is never greyed and has no Done chip.
function SendFasterCard() {
  return (
    <section className="card" aria-labelledby="step-3-title">
      <div className="card-head">
        <span className="badge">
          <span>3</span>
        </span>
        <h2 className="card-title" id="step-3-title">
          Send faster
        </h2>
      </div>
      <div className="shortcut-row">
        <ShortcutKeys />
        <span>sends the page you are on.</span>
        <button
          type="button"
          className="link shortcut-change"
          onClick={() => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        >
          Change shortcut
        </button>
      </div>
      <p className="muted pin-hint">
        Pin Glider to the toolbar so one click sends. Extensions menu → pin next to Glider.
      </p>
    </section>
  );
}

function ChatRow({
  chat,
  chats,
  current,
  checked,
  onPick,
}: {
  chat: Chat;
  chats: TelegramChats;
  current: boolean;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <label className="chat-row">
      <input
        type="radio"
        name="target-chat"
        aria-label={chat.name}
        checked={checked}
        onChange={onPick}
      />
      <ChatAvatar chat={chat} chats={chats} />
      <span className="chat-text">
        <span className="chat-name">{chat.name}</span>
        <span className="muted">{chat.detail}</span>
      </span>
      {current ? (
        <span className="chat-tag chat-tag-current">Current</span>
      ) : (
        <span className="chat-tag">{TAGS[chat.kind]}</span>
      )}
    </label>
  );
}
