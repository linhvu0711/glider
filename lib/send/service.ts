import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { targetChat, targetChatFor } from '../target-chat';
import { SendError, type TelegramSend } from '../telegram/send';
import {
  addressOf,
  isWebPage,
  type Link,
  type LinkFailure,
  type LinkId,
  type Opened,
  type Page,
  type Row,
  type Sends,
  type SendView,
} from './state';

// Local, so the links outlive a Chrome restart. The send service is the only reader and
// writer of this item; the popup gets rows from view().
const sendList = storage.defineItem<Sends>('local:links', {
  fallback: { links: [], times: [] },
});

// Chrome empties session storage when it closes, so false at start means Chrome started
// again, not a worker waking up. The send service is its only writer.
const browserOpen = storage.defineItem<boolean>('session:browserOpen', { fallback: false });

const UNDO_MS = 5_000;
// How long a sent link stays in the popup.
const SHOWN_MS = 2_500;
const SEND_LIMIT = 10;
const LIMIT_MS = 60_000;
// How long the badge shows the check after a send.
const CHECK_MS = 2_000;
const BLUE = '#2563eb';
const GREEN = '#16a34a';
const RED = '#dc2626';

// One answer per state, so one send never shows two badges.
function badgeFor(links: Link[], sentAt: number | null, now: number) {
  const waiting = links.filter((l) => l.status === 'waiting' || l.status === 'sending').length;
  if (waiting > 0) return { text: String(waiting), color: BLUE };
  if (sentAt !== null && now - sentAt < CHECK_MS) return { text: '✓', color: GREEN };
  // The count and the check pass on their own; the ! waits for the user.
  if (links.some((l) => l.status === 'failed')) return { text: '!', color: RED };
  return { text: '', color: BLUE };
}

function rowOf(link: Link, now: number): Row {
  const row = {
    id: link.id,
    title: link.page.title,
    address: addressOf(link.page.url),
    icon: link.page.icon,
    chat: link.chat.name,
  };
  switch (link.status) {
    case 'waiting':
      return {
        ...row,
        status: 'waiting',
        seconds: Math.max(1, Math.ceil((link.sendAt - now) / 1000)),
        leftMs: Math.max(0, link.sendAt - now),
      };
    case 'failed':
      return {
        ...row,
        status: 'failed',
        reason: link.failure.reason,
        text: FAILURE_TEXT[link.failure.reason].row(link.chat.name),
        retryIn: retryIn(link.failure, now),
      };
    default:
      return { ...row, status: link.status };
  }
}

function failureOf(e: unknown, now: number): LinkFailure {
  if (!(e instanceof SendError)) return { reason: 'other' };
  const { failure } = e;
  return failure.reason === 'wait'
    ? { reason: 'wait', retryAt: now + failure.seconds * 1000 }
    : { reason: failure.reason };
}

function retryIn(failure: LinkFailure, now: number): number {
  return failure.reason === 'wait' ? Math.max(0, Math.ceil((failure.retryAt - now) / 1000)) : 0;
}

// What the popup row and the system notice say for each reason, side by side.
const FAILURE_TEXT: {
  [R in LinkFailure['reason']]: {
    row: (chat: string) => string;
    notice: (chat: string, seconds: number) => string;
  };
} = {
  offline: { row: () => 'Not sent: no internet', notice: () => 'Not sent: no internet.' },
  'logged-out': {
    row: () => 'Not sent: you were logged out',
    notice: () => 'Not sent: you were logged out.',
  },
  unreachable: {
    row: (chat) => `Not sent: can't reach ${chat}`,
    notice: (chat) => `Can't send to ${chat}. It may be deleted, stopped, or blocked.`,
  },
  wait: {
    row: () => 'Not sent: Telegram asks to wait',
    notice: (_, seconds) => `Telegram asks to wait ${seconds} s.`,
  },
  other: {
    row: () => 'Not sent: something went wrong',
    notice: () => 'Not sent: something went wrong.',
  },
  closed: {
    row: () => 'Not sent: Chrome closed first',
    notice: () => 'Not sent: Chrome closed first.',
  },
};

export interface SendService {
  /** Loads the saved links; the worker calls it each time it wakes. */
  start(): Promise<void>;
  /** `page` is null when the tab has no address the extension may read. */
  open(page: Page | null): Promise<Opened>;
  undo(id: LinkId): Promise<void>;
  /** Sends a failed link at once, with no undo window. */
  retry(id: LinkId): Promise<void>;
  remove(id: LinkId): Promise<void>;
  /** The popup's rows, newest first, with the undo window and the send limit. */
  view(): Promise<SendView>;
}

export function createSendService(telegram: TelegramSend): SendService {
  let state: Sends = { links: [], times: [] };
  const timers = new Map<LinkId, ReturnType<typeof setTimeout>>();
  let queue: Promise<unknown> = Promise.resolve();
  let sentAt: number | null = null;
  let loaded: Promise<void> = Promise.resolve();

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

  function setStatus(id: LinkId, status: 'waiting' | 'sending' | 'sent' | 'undone') {
    return write({
      ...state,
      links: state.links.map((link): Link => (link.id === id ? { ...link, status } : link)),
    });
  }

  // The only place a link turns failed. The banner's id is the link's, so a new failure
  // of the same link replaces its banner.
  async function fail(id: LinkId, failure: LinkFailure) {
    await write({
      ...state,
      links: state.links.map((link): Link =>
        link.id === id ? { ...link, status: 'failed', failure } : link,
      ),
    });
    const link = state.links.find((l) => l.id === id);
    if (!link) return;
    await browser.notifications.create(id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icons/128.png'),
      title: 'Glider',
      message: FAILURE_TEXT[failure.reason].notice(link.chat.name, retryIn(failure, Date.now())),
      contextMessage: addressOf(link.page.url),
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
        await fail(id, { reason: 'logged-out' });
        return undefined;
      }
      await setStatus(id, 'sending');
      return found;
    });
    if (link) await deliver(link);
  }

  async function deliver(link: Link) {
    const failure = await telegram.sendText(link.chat.id, link.page.url, link.id).then(
      () => null,
      (e: unknown) => failureOf(e, Date.now()),
    );
    await serial(() => {
      if (failure) return fail(link.id, failure);
      sentAt = Date.now();
      return setStatus(link.id, 'sent');
    });
    if (failure) return;
    dropLater(link.id);
    setTimeout(() => void serial(showBadge), CHECK_MS);
  }

  return {
    start() {
      loaded = serial(async () => {
        const saved = await sendList.getValue();
        const links = saved.links.filter(
          (link) => link.status !== 'sent' && link.status !== 'undone',
        );
        await write({ ...saved, links });
        const restarted = !(await browserOpen.getValue());
        for (const link of links) {
          // A link that was in flight when the worker stopped may have gone: never send it twice.
          // A failed link never sends by itself, so one Chrome closed on does not either.
          if (link.status === 'sending' || (link.status === 'waiting' && restarted)) {
            await fail(link.id, { reason: 'closed' });
          } else if (link.status === 'waiting') {
            schedule(link);
          }
        }
        await browserOpen.setValue(true);
      });
      return loaded;
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

    async retry(id) {
      const link = await serial(async () => {
        const found = state.links.find((l) => l.id === id);
        if (found?.status !== 'failed') return undefined;
        if (found.failure.reason === 'wait' && Date.now() < found.failure.retryAt) return undefined;
        if ((await telegram.account()) !== found.account) {
          await fail(id, { reason: 'logged-out' });
          return undefined;
        }
        await setStatus(id, 'sending');
        await browser.notifications.clear(id);
        return found;
      });
      // The popup's ask ends at Sending…; the row shows the rest.
      if (link) void deliver(link);
    },

    remove(id) {
      return serial(async () => {
        if (!state.links.some((link) => link.id === id && link.status === 'failed')) return;
        await drop(id);
        await browser.notifications.clear(id);
      });
    },

    // Not behind the queue, so a slow account check never stops the countdown.
    async view() {
      await loaded;
      const now = Date.now();
      return {
        rows: state.links.map((link) => rowOf(link, now)),
        undoMs: UNDO_MS,
        sendLimit: SEND_LIMIT,
      };
    },
  };
}
