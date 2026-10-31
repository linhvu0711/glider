import type { TelegramAuth } from '../telegram/auth';
import type { LoginCommand, LoginStep, LoginView } from './state';

export interface LoginService {
  send(command: LoginCommand): void;
  subscribe(listener: (view: LoginView) => void): () => void;
  stop(): void;
}

export function createLoginService(auth: TelegramAuth, device: string): LoginService {
  let view: LoginView = { login: { step: 'checking' }, notice: false };
  const listeners = new Set<(view: LoginView) => void>();
  let qr: AbortController | null = null;

  function show(login: LoginStep) {
    view = { ...view, login };
    for (const listener of listeners) listener(view);
  }

  function startQr() {
    qr?.abort();
    const controller = new AbortController();
    qr = controller;
    show({ step: 'qr', code: null, expired: false });
    auth
      .loginQr((code) => {
        if (!controller.signal.aborted) show({ step: 'qr', code, expired: false });
      }, controller.signal)
      .then(
        () => {},
        () => {},
      );
  }

  async function hello() {
    const account = await auth.restore().catch(() => null);
    if (account === null) startQr();
  }

  return {
    send(command) {
      if (command.type === 'hello') void hello();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(view);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      qr?.abort();
    },
  };
}
