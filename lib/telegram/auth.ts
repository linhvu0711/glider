/** `id` is the Telegram user id. */
export type Account = { id: number; name: string; initials: string };

/** `expires` is ms since the epoch. */
export type QrCode = { url: string; expires: number };

export class AuthError extends Error {
  constructor(
    readonly kind:
      | 'bad-phone'
      | 'bad-code'
      | 'code-expired'
      | 'bad-password'
      | 'offline'
      | 'session-ended',
  ) {
    super(kind);
    this.name = 'AuthError';
  }
}

/** Every method rejects only with `AuthError`. */
export interface TelegramAuth {
  restore(): Promise<Account | null>;
  loginQr(
    onCode: (code: QrCode) => void,
    signal: AbortSignal,
  ): Promise<Account | 'password'>;
  sendCode(phone: string): Promise<{ length: number }>;
  submitCode(code: string): Promise<Account | 'password'>;
  submitPassword(password: string): Promise<Account>;
  logOut(): Promise<void>;
  /** Deletes the session saved on this device, with no call to Telegram. */
  forget(): Promise<void>;
}
