import { browser } from 'wxt/browser';
import type { SendService } from './service';
import type { LinkId, Opened, Page, SendRequest } from './state';

export type SendReply = Opened | { ok: true };

function isSendRequest(message: unknown): message is SendRequest {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  switch (message.type) {
    case 'send.open':
      return 'page' in message && typeof message.page === 'object';
    case 'send.undo':
    case 'send.remove':
      return 'id' in message && typeof message.id === 'string';
    default:
      return false;
  }
}

/** The worker's side; undefined for a message that is not a send ask. */
export function answerSend(service: SendService): (message: unknown) => Promise<SendReply> | undefined {
  return (message) => {
    if (!isSendRequest(message)) return undefined;
    switch (message.type) {
      case 'send.open':
        return service.open(message.page);
      case 'send.undo':
        return service.undo(message.id).then(() => ({ ok: true }));
      case 'send.remove':
        return service.remove(message.id).then(() => ({ ok: true }));
    }
  };
}

export interface SendConnection {
  open(page: Page | null): Promise<Opened>;
  undo(id: LinkId): Promise<void>;
  remove(id: LinkId): Promise<void>;
}

// The popup's side. The links themselves come from storage, not from these replies.
export function connectSend(
  send: (request: SendRequest) => Promise<SendReply> = (request) =>
    browser.runtime.sendMessage(request),
): SendConnection {
  return {
    open: (page) => send({ type: 'send.open', page }) as Promise<Opened>,
    undo: async (id) => {
      await send({ type: 'send.undo', id });
    },
    remove: async (id) => {
      await send({ type: 'send.remove', id });
    },
  };
}

// sendResponse with `return true` works in every Chrome version; a returned promise does not.
export function serveSend(service: SendService) {
  const answer = answerSend(service);
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const reply = answer(message);
    if (!reply) return;
    void reply.then(sendResponse);
    return true;
  });
}
