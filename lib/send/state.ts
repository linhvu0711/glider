import type { Chat } from '../telegram/chats';

export type LinkId = string & { readonly __linkId: true };

/** The tab the user sent: its address, its title, and its icon URL. */
export type Page = { url: string; title: string; icon: string | null };

/** Why a link was not sent. `retryAt` is ms since the epoch: Telegram takes it again from then. */
export type LinkFailure =
  | { reason: 'offline' | 'logged-out' | 'unreachable' | 'other' | 'closed' }
  | { reason: 'wait'; retryAt: number };

/** `account` is the Telegram user id that sent it; `sendAt` is ms since the epoch. */
export type Link = {
  id: LinkId;
  page: Page;
  account: number;
  chat: Chat;
  sendAt: number;
} & (
  | { status: 'waiting' | 'sending' | 'sent' | 'undone' }
  | { status: 'failed'; failure: LinkFailure }
);

export type LinkStatus = Link['status'];

/** Newest link first. `times` holds the ms of each send that added a link, for the send limit. */
export type Sends = { links: Link[]; times: number[] };

export type Opened =
  | { kind: 'setup' }
  | { kind: 'added'; chat: Chat; id: LinkId }
  | { kind: 'already'; chat: Chat; id: LinkId }
  | { kind: 'limit'; chat: Chat; seconds: number }
  | { kind: 'not-web'; chat: Chat };

/** Only http and https pages can be sent; New Tab, `chrome://` and `file://` cannot. */
export function isWebPage(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** The address as the mockup shows it: no protocol, no `www.`, no lone `/`. */
export function addressOf(url: string): string {
  const { host, pathname, search } = new URL(url);
  return host.replace(/^www\./, '') + (pathname === '/' ? '' : pathname) + search;
}
