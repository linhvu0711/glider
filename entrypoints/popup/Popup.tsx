import { useEffect, useState } from 'react';
import { ChatAvatar } from '../../components/chat-avatar';
import { AlertIcon, GearIcon, GlobeIcon, UndoIcon } from '../../components/icons';
import { ShortcutKeys } from '../../components/shortcut-keys';
import type { SendConnection } from '../../lib/send/connection';
import { SEND_LIMIT, sendList, UNDO_MS } from '../../lib/send/service';
import { addressOf, type Link, type Opened } from '../../lib/send/state';
import type { TelegramChats } from '../../lib/telegram/chats';

// The send service writes the links; the popup only shows them.
function useLinks(): Link[] {
  const [links, setLinks] = useState<Link[]>([]);
  useEffect(() => {
    let live = true;
    void sendList.getValue().then((value) => {
      if (live) setLinks(value.links);
    });
    const unwatch = sendList.watch((value) => setLinks(value.links));
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  return links;
}

function useOpened(opened: Promise<Opened>): Opened | null {
  const [result, setResult] = useState<Opened | null>(null);
  useEffect(() => {
    let live = true;
    void opened.then((value) => {
      if (live) setResult(value);
    });
    return () => {
      live = false;
    };
  }, [opened]);
  return result;
}

const TICK_MS = 250;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Popup({
  sender,
  opened,
  chats,
  openSettings,
  openChatSettings,
  close,
}: {
  sender: SendConnection;
  opened: Promise<Opened>;
  chats: TelegramChats;
  openSettings: () => void;
  /** Opens the settings page at step 2, to pick another chat. */
  openChatSettings: () => void;
  close: () => void;
}) {
  const result = useOpened(opened);
  const links = useLinks();
  const now = useNow();

  // Chrome closes the popup on a click outside; Escape closes it here in every browser.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!result) return <div className="popup" />;
  if (result.kind === 'setup') {
    return (
      <div className="popup popup-setup">
        <AlertIcon className="setup-icon" width={22} height={22} />
        <h1 className="setup-title">Set up Glider first</h1>
        <p className="muted setup-text">Log in and pick a chat in the settings.</p>
        <button type="button" className="button" onClick={openSettings}>
          Open settings
        </button>
      </div>
    );
  }
  const focus = result.kind === 'added' || result.kind === 'already' ? result.id : null;
  return (
    <div className="popup">
      <header className="popup-head">
        <ChatAvatar chat={result.chat} chats={chats} />
        <span className="popup-chat">
          <span className="muted">Sending to</span>
          <span className="popup-chat-name">{result.chat.name}</span>
        </span>
        <button type="button" className="icon-button" aria-label="Settings" onClick={openSettings}>
          <GearIcon width={18} height={18} />
        </button>
      </header>
      {result.kind === 'already' && (
        <Note text="This page is already waiting. It was not added twice." />
      )}
      {result.kind === 'limit' && (
        <Note
          text={`Slow down. You can send ${SEND_LIMIT} links a minute. Try again in ${result.seconds} s.`}
        />
      )}
      {result.kind === 'not-web' && (
        <Note
          title="Nothing to send here"
          text="Nothing to send on this page. Glider sends web pages only."
        />
      )}
      {links.length === 0 ? (
        <p className="muted nothing">Nothing waiting</p>
      ) : (
        <ul className="rows">
          {links.map((link) => (
            <Row
              key={link.id}
              link={link}
              now={now}
              focus={link.id === focus}
              onUndo={() => void sender.undo(link.id)}
              onRetry={() => void sender.retry(link.id)}
              onLogIn={() => openSettings()}
              onPickChat={() => openChatSettings()}
              onRemove={() => void sender.remove(link.id)}
            />
          ))}
        </ul>
      )}
      <footer className="popup-foot">
        <ShortcutKeys />
        <span>to send</span>
        <span className="popup-undo">5 s to undo</span>
      </footer>
    </div>
  );
}

function Note({ title, text }: { title?: string; text: string }) {
  return (
    <div className="note" role="status">
      <AlertIcon className="note-icon" width={16} height={16} />
      <span className="note-text">
        {title && <span className="note-title">{title}</span>}
        <span>{text}</span>
      </span>
    </div>
  );
}

function reasonOf(link: Link & { status: 'failed' }): string {
  switch (link.failure.reason) {
    case 'offline':
      return 'Not sent: no internet';
    case 'logged-out':
      return 'Not sent: you were logged out';
    case 'unreachable':
      return `Not sent: can't reach ${link.chat.name}`;
    case 'wait':
      return 'Not sent: Telegram asks to wait';
    case 'other':
      return 'Not sent: something went wrong';
    case 'closed':
      return 'Not sent: Chrome closed first';
  }
}

function RetryButton({
  link,
  now,
  onRetry,
}: {
  link: Link & { status: 'failed' };
  now: number;
  onRetry: () => void;
}) {
  const wait =
    link.failure.reason === 'wait' ? Math.ceil((link.failure.retryAt - now) / 1000) : 0;
  return (
    <button type="button" className="button row-button" disabled={wait > 0} onClick={onRetry}>
      {wait > 0 ? `Retry in ${wait} s` : 'Retry'}
    </button>
  );
}

function Row({
  link,
  now,
  focus,
  onUndo,
  onRetry,
  onLogIn,
  onPickChat,
  onRemove,
}: {
  link: Link;
  now: number;
  focus: boolean;
  onUndo: () => void;
  onRetry: () => void;
  onLogIn: () => void;
  onPickChat: () => void;
  onRemove: () => void;
}) {
  // Set once, so the bar keeps draining from where the send left it, also after the popup opens again.
  const [drainDelay] = useState(() => -(UNDO_MS - Math.max(0, link.sendAt - Date.now())));
  const waiting = link.status === 'waiting';
  return (
    <li className="row">
      <span className="row-icon">
        {link.page.icon ? (
          <img src={link.page.icon} alt="" width={20} height={20} />
        ) : (
          <GlobeIcon width={20} height={20} />
        )}
      </span>
      <span className="row-text">
        <span className="row-title">{link.page.title}</span>
        <span className="row-address">{addressOf(link.page.url)}</span>
        {waiting && (
          <span className="row-state row-state-blue">{`Sending in ${Math.max(1, Math.ceil((link.sendAt - now) / 1000))} s`}</span>
        )}
        {link.status === 'sending' && <span className="row-state row-state-blue">Sending…</span>}
        {link.status === 'sent' && (
          <span className="row-state row-state-green">{`Sent to ${link.chat.name}`}</span>
        )}
        {link.status === 'undone' && (
          <span className="row-state muted">Undone. Nothing was sent.</span>
        )}
        {link.status === 'failed' && (
          <span className="row-state row-state-red row-reason">
            <AlertIcon width={14} height={14} />
            <span>{reasonOf(link)}</span>
          </span>
        )}
        {link.status === 'failed' && (
          <span className="row-actions">
            <RetryButton link={link} now={now} onRetry={onRetry} />
            {link.failure.reason === 'logged-out' && (
              <button type="button" className="button-plain row-button" onClick={onLogIn}>
                Log in again
              </button>
            )}
            {link.failure.reason === 'unreachable' && (
              <button type="button" className="button-plain row-button" onClick={onPickChat}>
                Pick another chat
              </button>
            )}
            <button type="button" className="row-quiet" onClick={onRemove}>
              Remove
            </button>
          </span>
        )}
      </span>
      {waiting && (
        <button
          type="button"
          className="button-plain undo"
          autoFocus={focus}
          onClick={onUndo}
        >
          <UndoIcon width={14} height={14} />
          <span>Undo</span>
        </button>
      )}
      {waiting && (
        <span
          className="drain"
          data-testid="drain-bar"
          style={{ animationDuration: `${UNDO_MS}ms`, animationDelay: `${drainDelay}ms` }}
        />
      )}
    </li>
  );
}
