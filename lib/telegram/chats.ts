/** Telegram's marked peer id: users as is, basic groups negative, channels -100… */
export type ChatId = number & { readonly __chatId: true };

export type ChatKind = 'self' | 'person' | 'bot' | 'group' | 'channel';

export type Chat = {
  id: ChatId;
  kind: ChatKind;
  name: string;
  username: string | null;
  detail: string;
  initials: string;
  hasPhoto: boolean;
};

export interface TelegramChats {
  /** Rejects on any failure. */
  list(): Promise<Chat[]>;
  /** A data URL, or null when there is none or it could not load. */
  photo(id: ChatId): Promise<string | null>;
}
