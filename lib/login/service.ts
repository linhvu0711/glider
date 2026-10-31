import { AuthError, type Account, type TelegramAuth } from '../telegram/auth';
import type { LoginCommand, LoginStep, LoginView } from './state';

export interface LoginService {
  send(command: LoginCommand): void;
  subscribe(listener: (view: LoginView) => void): () => void;
  stop(): void;
}

function isBusy(login: LoginStep): boolean {
  switch (login.step) {
    case 'phone':
    case 'code':
    case 'password':
      return login.busy;
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

  function show(login: LoginStep) {
    view = { ...view, login };
    for (const listener of listeners) listener(view);
  }

  function stopQr() {
    qr?.abort();
    qr = null;
  }

  function done(account: Account) {
    show({ step: 'done', account, device, logout: 'idle' });
  }

  function startQr() {
    stopQr();
    const controller = new AbortController();
    qr = controller;
    show({ step: 'qr', code: null, expired: false });
    auth
      .loginQr((code) => {
        if (!controller.signal.aborted) show({ step: 'qr', code, expired: false });
      }, controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          if (result === 'password') show({ step: 'password', error: null, busy: false });
          else done(result);
        },
        () => {},
      );
  }

  async function hello() {
    const account = await auth.restore().catch(() => null);
    if (account === null) startQr();
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
      if (kind === 'code-expired') show({ ...current, error: 'expired', busy: false });
    }
  }

  async function submitPassword(password: string) {
    if (view.login.step !== 'password') return;
    show({ step: 'password', error: null, busy: true });
    try {
      done(await auth.submitPassword(password));
    } catch (e) {
      if (kindOf(e) === 'bad-password') show({ step: 'password', error: 'wrong', busy: false });
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
          startQr();
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
