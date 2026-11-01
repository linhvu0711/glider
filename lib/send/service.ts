import { storage } from 'wxt/utils/storage';
import { targetChat, targetChatFor } from '../target-chat';
import type { TelegramSend } from '../telegram/send';
import type { Link, LinkId, LinkStatus, Opened, Page, Sends } from './state';

// The send service is the only writer of this item. The popup reads and watches it.
export const sendList = storage.defineItem<Sends>('session:links', {
  fallback: { links: [], times: [] },
});

export const UNDO_MS = 5_000;
// How long a sent link stays in the popup.
const SHOWN_MS = 2_500;

export interface SendService {
  /** Loads the saved links; the worker calls it each time it wakes. */
  start(): Promise<void>;
  open(page: Page): Promise<Opened>;
  undo(id: LinkId): Promise<void>;
  remove(id: LinkId): Promise<void>;
}

export function createSendService(telegram: TelegramSend): SendService {
  let state: Sends = { links: [], times: [] };
  const timers = new Map<LinkId, ReturnType<typeof setTimeout>>();
  let queue: Promise<unknown> = Promise.resolve();

  // One change at a time, so no write is lost to another.
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  }

  async function write(next: Sends) {
    state = next;
    await sendList.setValue(next);
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
      if (found) await setStatus(id, 'sending');
      return found;
    });
    if (!link) return;
    const sent = await telegram.sendText(link.chat.id, link.page.url).then(
      () => true,
      () => false,
    );
    await serial(() => setStatus(id, sent ? 'sent' : 'failed'));
    if (sent) dropLater(id);
  }

  return {
    start() {
      return serial(async () => {
        state = await sendList.getValue();
      });
    },

    open(page) {
      return serial(async (): Promise<Opened> => {
        const account = await telegram.account();
        const chat = account === null ? null : targetChatFor(await targetChat.getValue(), account);
        if (account === null || !chat) return { kind: 'setup' };
        const now = Date.now();
        const link: Link = {
          id: crypto.randomUUID() as LinkId,
          page,
          account,
          chat,
          sendAt: now + UNDO_MS,
          status: 'waiting',
        };
        await write({ links: [link, ...state.links], times: [...state.times, now] });
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

    async remove() {},
  };
}
