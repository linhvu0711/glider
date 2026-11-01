import { storage } from 'wxt/utils/storage';
import type { Chat } from './telegram/chats';

/** `account` is the Telegram user id of the account that saved `chat`. */
export type TargetChat = { account: number; chat: Chat };

// The settings page's Save is the only writer of this item.
export const targetChat = storage.defineItem<TargetChat | null>('local:targetChat', {
  fallback: null,
});

/** The saved chat when `account` saved it, else null: links never go to another account's chat. */
export function targetChatFor(saved: TargetChat | null, account: number): Chat | null {
  return saved?.account === account ? saved.chat : null;
}
