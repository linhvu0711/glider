import type { ChatId } from './chats';

/**
 * Why Telegram did not take a send. `repeat`: it already has a message with this key.
 * `seconds` is how long Telegram asks to wait.
 */
export type SendFailure =
  | { reason: 'repeat' }
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
   * `signal` aborts when the send code stops waiting; send nothing after it.
   */
  sendText(chat: ChatId, text: string, key: string, signal: AbortSignal): Promise<void>;
}
