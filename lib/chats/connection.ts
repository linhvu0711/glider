import { browser } from 'wxt/browser';
import type { Chat, ChatId, TelegramChats } from '../telegram/chats';

export type ChatsRequest = { type: 'chats.list' } | { type: 'chats.photo'; id: ChatId };

export type ChatsReply =
  | { ok: true; chats: Chat[] }
  | { ok: true; photo: string | null }
  | { ok: false };

function isChatsRequest(message: unknown): message is ChatsRequest {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  return (
    message.type === 'chats.list' ||
    (message.type === 'chats.photo' && 'id' in message && typeof message.id === 'number')
  );
}

/** The worker's side; undefined for a message that is not a chat ask. */
export function answerChats(
  get: () => TelegramChats | null,
): (message: unknown) => Promise<ChatsReply> | undefined {
  return (message) => {
    if (!isChatsRequest(message)) return undefined;
    const chats = get();
    if (!chats) return Promise.resolve({ ok: false });
    if (message.type === 'chats.photo') {
      return chats.photo(message.id).then(
        (photo) => ({ ok: true, photo }),
        () => ({ ok: false }),
      );
    }
    return chats.list().then(
      (list) => ({ ok: true, chats: list }),
      () => ({ ok: false }),
    );
  };
}

// The page's side. Chat asks are per tab, unlike the login view, which goes to every tab.
export function connectChats(
  send: (request: ChatsRequest) => Promise<ChatsReply> = (request) =>
    browser.runtime.sendMessage(request),
): TelegramChats {
  return {
    async list() {
      const reply = await send({ type: 'chats.list' }).catch((): ChatsReply => ({ ok: false }));
      if (!reply.ok || !('chats' in reply)) throw new Error('chats');
      return reply.chats;
    },
    async photo(id) {
      const reply = await send({ type: 'chats.photo', id }).catch((): ChatsReply => ({ ok: false }));
      return reply.ok && 'photo' in reply ? reply.photo : null;
    },
  };
}

// sendResponse with `return true` works in every Chrome version; a returned promise does not.
export function serveChats(get: () => TelegramChats | null) {
  const answer = answerChats(get);
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const reply = answer(message);
    if (!reply) return;
    void reply.then(sendResponse);
    return true;
  });
}
