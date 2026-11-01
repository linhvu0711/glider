import { useEffect, useState } from 'react';
import { ChatAvatar } from '../../components/chat-avatar';
import { GearIcon, GlobeIcon, UndoIcon } from '../../components/icons';
import { ShortcutKeys } from '../../components/shortcut-keys';
import type { SendConnection } from '../../lib/send/connection';
import { sendList, UNDO_MS } from '../../lib/send/service';
import type { Link, LinkId, Opened } from '../../lib/send/state';
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

/** The address as the mockup shows it: no protocol, no `www.`, no lone `/`. */
export function addressOf(url: string): string {
  const { host, pathname, search } = new URL(url);
  return host.replace(/^www\./, '') + (pathname === '/' ? '' : pathname) + search;
}

export default function Popup({
  sender,
  opened,
  chats,
  openSettings,
  close,
}: {
  sender: SendConnection;
  opened: Promise<Opened>;
  chats: TelegramChats;
  openSettings: () => void;
  close: () => void;
}) {
  const result = useOpened(opened);
  const links = useLinks();
  const now = useNow();
  if (!result || result.kind === 'setup') return <div className="popup" />;
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
      <ul className="rows">
        {links.map((link) => (
          <Row
            key={link.id}
            link={link}
            now={now}
            focus={link.id === focus}
            onUndo={() => void sender.undo(link.id)}
          />
        ))}
      </ul>
      <footer className="popup-foot">
        <ShortcutKeys />
        <span>to send</span>
        <span className="popup-undo">5 s to undo</span>
      </footer>
    </div>
  );
}

function Row({
  link,
  now,
  focus,
  onUndo,
}: {
  link: Link;
  now: number;
  focus: boolean;
  onUndo: (id: LinkId) => void;
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
        {link.status === 'undone' && (
          <span className="row-state muted">Undone. Nothing was sent.</span>
        )}
      </span>
      {waiting && (
        <button
          type="button"
          className="button-plain undo"
          autoFocus={focus}
          onClick={() => onUndo(link.id)}
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
