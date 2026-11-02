import type { ChatId } from './chats';

/** Why a send did not reach Telegram. `seconds` is how long Telegram asks to wait. */
export type SendFailure =
  | { reason: 'offline' }
  | { reason: 'logged-out' }
  | { reason: 'unreachable' }
  | { reason: 'wait'; seconds: number }
  | { reason: 'other' };

export class SendError extends Error {
  constructor(readonly failure: SendFailure) {
    super(failure.reason);
    this.name = 'SendError';
  }
}

export interface TelegramSend {
  /** The Telegram user id of the saved session, or null. Reads saved data only. */
  account(): Promise<number | null>;
  /**
   * `key` is the link id; a Retry passes the same key, so Telegram can tell a repeat.
   * Rejects with SendError, or with anything else for a cause no reason names.
   */
  sendText(chat: ChatId, text: string, key: string): Promise<void>;
}
