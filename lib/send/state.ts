import type { Chat } from '../telegram/chats';

export type LinkId = string & { readonly __linkId: true };

/** The tab the user sent: its address, its title, and its icon URL. */
export type Page = { url: string; title: string; icon: string | null };

export type LinkStatus = 'waiting' | 'sending' | 'sent' | 'undone' | 'failed';

/** `account` is the Telegram user id that sent it; `sendAt` is ms since the epoch. */
export type Link = {
  id: LinkId;
  page: Page;
  account: number;
  chat: Chat;
  sendAt: number;
  status: LinkStatus;
};

/** Newest link first. `times` holds the ms of each send that added a link, for the send limit. */
export type Sends = { links: Link[]; times: number[] };

export type Opened =
  | { kind: 'setup' }
  | { kind: 'added'; chat: Chat; id: LinkId }
  | { kind: 'already'; chat: Chat; id: LinkId }
  | { kind: 'limit'; chat: Chat; seconds: number }
  | { kind: 'not-web'; chat: Chat };

export type SendRequest =
  | { type: 'send.open'; page: Page | null }
  | { type: 'send.undo'; id: LinkId }
  | { type: 'send.remove'; id: LinkId };

/** Only http and https pages can be sent; New Tab, `chrome://` and `file://` cannot. */
export function isWebPage(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
