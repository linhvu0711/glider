import { browser, type Browser } from 'wxt/browser';
import type { LoginService } from './service';
import type { LoginCommand, LoginView } from './state';

export interface LoginConnection {
  send(command: LoginCommand): void;
  subscribe(listener: (view: LoginView) => void): () => void;
}

const PING_EVERY_MS = 20_000;
const RECONNECT_AFTER_MS = 500;

// A message over a long-lived port keeps the service worker awake, an open port alone does not.
export function connectPort(): LoginConnection {
  const listeners = new Set<(view: LoginView) => void>();
  let hello: LoginCommand = { type: 'hello' };
  let port: Browser.runtime.Port;

  function open() {
    port = browser.runtime.connect({ name: 'login' });
    port.onMessage.addListener((view: LoginView) => {
      for (const listener of listeners) listener(view);
    });
    const ping = setInterval(() => port.postMessage({ type: 'ping' }), PING_EVERY_MS);
    port.onDisconnect.addListener(() => {
      clearInterval(ping);
      setTimeout(() => {
        open();
        port.postMessage(hello);
      }, RECONNECT_AFTER_MS);
    });
  }

  open();

  return {
    send(command) {
      if (command.type === 'hello') hello = command;
      port.postMessage(command);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function servePort(port: Browser.runtime.Port, service: LoginService) {
  port.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && 'type' in message) {
      service.send(message as LoginCommand);
    }
  });
  const unsubscribe = service.subscribe((view) => port.postMessage(view));
  port.onDisconnect.addListener(unsubscribe);
}
