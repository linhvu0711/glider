import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { targetChat, targetChatFor } from '../target-chat';
import type { TelegramSend } from '../telegram/send';
import { isWebPage, type Link, type LinkId, type LinkStatus, type Opened, type Page, type Sends } from './state';

// The send service is the only writer of this item. The popup reads and watches it.
export const sendList = storage.defineItem<Sends>('session:links', {
  fallback: { links: [], times: [] },
});

export const UNDO_MS = 5_000;
// How long a sent link stays in the popup.
const SHOWN_MS = 2_500;
export const SEND_LIMIT = 10;
const LIMIT_MS = 60_000;
// How long the badge shows the check after a send.
const CHECK_MS = 2_000;
const BLUE = '#2563eb';
const GREEN = '#16a34a';

// One answer per state, so one send never shows two badges.
function badgeFor(links: Link[], sentAt: number | null, now: number) {
  const waiting = links.filter((l) => l.status === 'waiting' || l.status === 'sending').length;
  if (waiting > 0) return { text: String(waiting), color: BLUE };
  if (sentAt !== null && now - sentAt < CHECK_MS) return { text: '✓', color: GREEN };
  return { text: '', color: BLUE };
}

export interface SendService {
  /** Loads the saved links; the worker calls it each time it wakes. */
  start(): Promise<void>;
  /** `page` is null when the tab has no address the extension may read. */
  open(page: Page | null): Promise<Opened>;
  undo(id: LinkId): Promise<void>;
  remove(id: LinkId): Promise<void>;
}

export function createSendService(telegram: TelegramSend): SendService {
  let state: Sends = { links: [], times: [] };
  const timers = new Map<LinkId, ReturnType<typeof setTimeout>>();
  let queue: Promise<unknown> = Promise.resolve();
  let sentAt: number | null = null;

  // One change at a time, so no write is lost to another.
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  }

  // The service is the badge's only writer too.
  async function showBadge() {
    const { text, color } = badgeFor(state.links, sentAt, Date.now());
    await Promise.all([
      browser.action.setBadgeText({ text }),
      browser.action.setBadgeBackgroundColor({ color }),
      browser.action.setBadgeTextColor({ color: '#fff' }),
    ]);
  }

  async function write(next: Sends) {
    state = next;
    await sendList.setValue(next);
    await showBadge();
  }

  function setStatus(id: LinkId, status: LinkStatus) {
    return write({
      ...state,
      links: state.links.map((link) => (link.id === id ? { ...link, status } : link)),
    });
  }

  function drop(id: LinkId) {
    return write({ ...state, links: state.links.filter((link) => link.id !== id) });
  }

  function dropLater(id: LinkId) {
    setTimeout(() => void serial(() => drop(id)), SHOWN_MS);
  }

  function schedule(link: Link) {
    clearTimeout(timers.get(link.id));
    timers.set(
      link.id,
      setTimeout(() => void fire(link.id), Math.max(0, link.sendAt - Date.now())),
    );
  }

  async function fire(id: LinkId) {
    timers.delete(id);
    const link = await serial(async () => {
      const found = state.links.find((l) => l.id === id && l.status === 'waiting');
      if (!found) return undefined;
      // A log out while it waited means the link is not sent (the log out dialog says so).
      if ((await telegram.account()) !== found.account) {
        await setStatus(id, 'failed');
        return undefined;
      }
      await setStatus(id, 'sending');
      return found;
    });
    if (!link) return;
    const sent = await telegram.sendText(link.chat.id, link.page.url).then(
      () => true,
      () => false,
    );
    await serial(() => {
      if (sent) sentAt = Date.now();
      return setStatus(id, sent ? 'sent' : 'failed');
    });
    if (!sent) return;
    dropLater(id);
    setTimeout(() => void serial(showBadge), CHECK_MS);
  }

  return {
    start() {
      return serial(async () => {
        const saved = await sendList.getValue();
        // A link that was in flight when the worker stopped may have gone: never send it twice.
        const links = saved.links
          .filter((link) => link.status !== 'sent' && link.status !== 'undone')
          .map((link): Link => (link.status === 'sending' ? { ...link, status: 'failed' } : link));
        await write({ ...saved, links });
        for (const link of links) if (link.status === 'waiting') schedule(link);
      });
    },

    open(page) {
      return serial(async (): Promise<Opened> => {
        const account = await telegram.account();
        const chat = account === null ? null : targetChatFor(await targetChat.getValue(), account);
        if (account === null || !chat) return { kind: 'setup' };
        if (!page || !isWebPage(page.url)) return { kind: 'not-web', chat };
        const waiting = state.links.find(
          (link) =>
            link.page.url === page.url && (link.status === 'waiting' || link.status === 'sending'),
        );
        if (waiting) return { kind: 'already', chat, id: waiting.id };
        const now = Date.now();
        const times = state.times.filter((time) => time > now - LIMIT_MS);
        if (times.length >= SEND_LIMIT) {
          return { kind: 'limit', chat, seconds: Math.ceil((times[0]! + LIMIT_MS - now) / 1000) };
        }
        const link: Link = {
          id: crypto.randomUUID() as LinkId,
          page,
          account,
          chat,
          sendAt: now + UNDO_MS,
          status: 'waiting',
        };
        await write({ links: [link, ...state.links], times: [...times, now] });
        schedule(link);
        return { kind: 'added', chat, id: link.id };
      });
    },

    undo(id) {
      return serial(async () => {
        if (!state.links.some((link) => link.id === id && link.status === 'waiting')) return;
        clearTimeout(timers.get(id));
        timers.delete(id);
        await setStatus(id, 'undone');
        dropLater(id);
      });
    },

    remove(id) {
      return serial(async () => {
        if (state.links.some((link) => link.id === id && link.status === 'failed')) await drop(id);
      });
    },
  };
}
