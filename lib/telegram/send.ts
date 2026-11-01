import type { ChatId } from './chats';

export interface TelegramSend {
  /** The Telegram user id of the saved session, or null. Reads saved data only. */
  account(): Promise<number | null>;
  /** Rejects on any failure. */
  sendText(chat: ChatId, text: string): Promise<void>;
}
