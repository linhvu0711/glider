import { storage } from 'wxt/utils/storage';
import type { Chat } from './telegram/chats';

// The settings page's Save is the only writer of this item.
export const targetChat = storage.defineItem<Chat | null>('local:targetChat', {
  fallback: null,
});
