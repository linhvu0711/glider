import type { Account, QrCode } from '../telegram/auth';

export type LoginStep =
  | { step: 'checking' }
  | { step: 'qr'; code: QrCode | null; expired: boolean }
  | { step: 'phone'; error: string | null; busy: boolean }
  | {
      step: 'code';
      phone: string;
      length: number;
      error: 'wrong' | 'expired' | null;
      busy: boolean;
    }
  | { step: 'password'; error: 'wrong' | null; busy: boolean }
  | { step: 'offline' }
  | {
      step: 'done';
      account: Account;
      device: string;
      logout: 'idle' | 'busy' | 'offline';
    };

export type LoginView = {
  login: LoginStep;
  notice: boolean;
  // The account the page works for. A session check is not a log out, so it stays through checking.
  account: Account | null;
};

export type LoginCommand =
  | { type: 'hello'; fake?: string }
  | { type: 'ping' }
  | { type: 'newQr' }
  | { type: 'usePhone' }
  | { type: 'useQr' }
  | { type: 'sendCode'; country: string; number: string }
  | { type: 'changeNumber' }
  | { type: 'submitCode'; code: string }
  | { type: 'resendCode' }
  | { type: 'submitPassword'; password: string }
  | { type: 'retry' }
  | { type: 'logOut' }
  | { type: 'logInAgain' };
