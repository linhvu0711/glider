import { storage } from 'wxt/utils/storage';
import { AuthError, type Account, type TelegramAuth } from '../telegram/auth';
import type { LoginCommand, LoginStep, LoginView } from './state';

export interface LoginService {
  send(command: LoginCommand): void;
  subscribe(listener: (view: LoginView) => void): () => void;
  stop(): void;
}

// The service is the only writer of this item.
const loggedOutNotice = storage.defineItem<boolean>('local:loggedOutNotice', {
  fallback: false,
});

// Telegram's codes live 30 s, so 5 codes are about 2.5 minutes of waiting.
const MAX_QR_CODES = 5;

function isBusy(login: LoginStep): boolean {
  switch (login.step) {
    case 'phone':
    case 'code':
    case 'password':
      return login.busy;
    case 'done':
      return login.logout === 'busy';
    default:
      return false;
  }
}

function kindOf(e: unknown): AuthError['kind'] {
  return e instanceof AuthError ? e.kind : 'offline';
}

export function createLoginService(auth: TelegramAuth, device: string): LoginService {
  let view: LoginView = { login: { step: 'checking' }, notice: false };
  const listeners = new Set<(view: LoginView) => void>();
  let qr: AbortController | null = null;

  let checking = false;

  function publish(next: LoginView) {
    view = next;
    for (const listener of listeners) listener(view);
  }

  function show(login: LoginStep) {
    publish({ ...view, login });
  }

  async function setNotice(notice: boolean) {
    await loggedOutNotice.setValue(notice);
    if (view.notice !== notice) publish({ ...view, notice });
  }

  function stopQr() {
    qr?.abort();
    qr = null;
  }

  function done(account: Account) {
    void setNotice(false);
    show({ step: 'done', account, device, logout: 'idle' });
  }

  function startQr() {
    stopQr();
    const controller = new AbortController();
    qr = controller;
    show({ step: 'qr', code: null, expired: false });
    let codes = 0;
    auth
      .loginQr((code) => {
        if (controller.signal.aborted) return;
        codes += 1;
        if (codes > MAX_QR_CODES) {
          stopQr();
          show({ step: 'qr', code: null, expired: true });
        } else {
          show({ step: 'qr', code, expired: false });
        }
      }, controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          if (result === 'password') show({ step: 'password', error: null, busy: false });
          else done(result);
        },
        (e) => {
          if (!controller.signal.aborted && kindOf(e) === 'offline') show({ step: 'offline' });
        },
      );
  }

  async function hello() {
    if (checking || isBusy(view.login)) return;
    checking = true;
    try {
      stopQr();
      publish({ login: { step: 'checking' }, notice: await loggedOutNotice.getValue() });
      const account = await auth.restore();
      if (account === null) startQr();
      else done(account);
    } catch (e) {
      if (kindOf(e) === 'session-ended') {
        await setNotice(true);
        startQr();
      } else {
        show({ step: 'offline' });
      }
    } finally {
      checking = false;
    }
  }

  async function sendCode(phone: string) {
    const current = view.login;
    if (current.step !== 'phone' && current.step !== 'code') return;
    show(
      current.step === 'phone'
        ? { step: 'phone', error: null, busy: true }
        : { ...current, error: null, busy: true },
    );
    try {
      const { length } = await auth.sendCode(phone);
      show({ step: 'code', phone, length, error: null, busy: false });
    } catch (e) {
      if (kindOf(e) === 'bad-phone') show({ step: 'phone', error: 'bad-phone', busy: false });
      else show({ step: 'offline' });
    }
  }

  async function submitCode(code: string) {
    const current = view.login;
    if (current.step !== 'code') return;
    show({ ...current, error: null, busy: true });
    try {
      const result = await auth.submitCode(code);
      if (result === 'password') show({ step: 'password', error: null, busy: false });
      else done(result);
    } catch (e) {
      const kind = kindOf(e);
      if (kind === 'bad-code') show({ ...current, error: 'wrong', busy: false });
      else if (kind === 'code-expired') show({ ...current, error: 'expired', busy: false });
      else show({ step: 'offline' });
    }
  }

  async function submitPassword(password: string) {
    if (view.login.step !== 'password') return;
    show({ step: 'password', error: null, busy: true });
    try {
      done(await auth.submitPassword(password));
    } catch (e) {
      if (kindOf(e) === 'bad-password') show({ step: 'password', error: 'wrong', busy: false });
      else show({ step: 'offline' });
    }
  }

  async function logOut() {
    const current = view.login;
    if (current.step !== 'done') return;
    show({ ...current, logout: 'busy' });
    try {
      await auth.logOut();
      startQr();
    } catch (e) {
      if (kindOf(e) === 'offline') show({ ...current, logout: 'offline' });
    }
  }

  return {
    send(command) {
      if (command.type === 'hello') return void hello();
      if (command.type === 'ping' || isBusy(view.login)) return;
      switch (command.type) {
        case 'usePhone':
          stopQr();
          show({ step: 'phone', error: null, busy: false });
          break;
        case 'changeNumber':
          show({ step: 'phone', error: null, busy: false });
          break;
        case 'useQr':
        case 'newQr':
          startQr();
          break;
        case 'logOut':
          void logOut();
          break;
        case 'retry':
          void hello();
          break;
        case 'dismissNotice':
          void setNotice(false);
          break;
        case 'sendCode':
          void sendCode(command.phone);
          break;
        case 'resendCode':
          if (view.login.step === 'code') void sendCode(view.login.phone);
          break;
        case 'submitCode':
          void submitCode(command.code);
          break;
        case 'submitPassword':
          void submitPassword(command.password);
          break;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(view);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      stopQr();
    },
  };
}
