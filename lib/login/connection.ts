import { browser } from 'wxt/browser';
import type { LoginService } from './service';
import type { LoginCommand, LoginView } from './state';

export interface LoginConnection {
  send(command: LoginCommand): void;
  subscribe(listener: (view: LoginView) => void): () => void;
}

/** What a settings page sends over the login port. */
type PortMessage =
  | { kind: 'command'; command: LoginCommand }
  | { kind: 'keepAlive' }
  | { kind: 'scenario'; name: string };

/** The part of a runtime port the login port uses; the browser's port fits it. */
export type LoginPort = {
  name: string;
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

function isPortMessage(message: unknown): message is PortMessage {
  return typeof message === 'object' && message !== null && 'kind' in message;
}

const PING_EVERY_MS = 20_000;
const RECONNECT_AFTER_MS = 500;

// A message over a long-lived port keeps the service worker awake, an open port alone does not.
export function connectLogin({
  scenario,
  connect = () => browser.runtime.connect({ name: 'login' }),
}: { scenario?: string; connect?: () => LoginPort } = {}): LoginConnection {
  const listeners = new Set<(view: LoginView) => void>();
  let hello: LoginCommand = { type: 'hello' };
  let port: LoginPort;

  function post(message: PortMessage) {
    port.postMessage(message);
  }

  function open() {
    port = connect();
    port.onMessage.addListener((view) => {
      for (const listener of listeners) listener(view as LoginView);
    });
    if (scenario !== undefined) post({ kind: 'scenario', name: scenario });
    const keepAlive = setInterval(() => post({ kind: 'keepAlive' }), PING_EVERY_MS);
    port.onDisconnect.addListener(() => {
      clearInterval(keepAlive);
      setTimeout(() => {
        open();
        post({ kind: 'command', command: hello });
      }, RECONNECT_AFTER_MS);
    });
  }

  open();

  return {
    send(command) {
      if (command.type === 'hello') hello = command;
      post({ kind: 'command', command });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type Started = { service: LoginService; unsubscribe: () => void };

// One login service for all open settings tabs, so two tabs never run two QR logins.
// A scenario from a page (fake builds only) swaps in a new service with a new fake.
export function serveLogin(
  load: (scenario?: string) => Promise<LoginService>,
  {
    fake,
    onConnect = (listener) => browser.runtime.onConnect.addListener(listener),
  }: { fake: boolean; onConnect?: (listener: (port: LoginPort) => void) => void },
): void {
  const listeners = new Set<(view: LoginView) => void>();
  // A tab that connects late gets this at once; its own hello may change nothing.
  let last: LoginView | null = null;
  let ports = 0;

  function start(scenario?: string): Promise<Started> {
    return load(scenario).then((service) => ({
      service,
      unsubscribe: service.subscribe((view) => {
        last = view;
        for (const listener of listeners) listener(view);
      }),
    }));
  }

  let current = start();

  function answer(message: unknown) {
    if (!isPortMessage(message)) return;
    if (message.kind === 'command') {
      const { command } = message;
      void current.then(({ service }) => service.send(command));
    } else if (message.kind === 'scenario' && fake) {
      const old = current;
      current = start(message.name);
      void old.then(({ service, unsubscribe }) => {
        unsubscribe();
        service.stop();
      });
    }
  }

  onConnect((port) => {
    if (port.name !== 'login') return;
    ports += 1;
    port.onMessage.addListener(answer);
    const listener = (view: LoginView) => port.postMessage(view);
    listeners.add(listener);
    if (last) listener(last);
    port.onDisconnect.addListener(() => {
      listeners.delete(listener);
      ports -= 1;
      if (ports === 0) void current.then(({ service }) => service.stop());
    });
  });
}
