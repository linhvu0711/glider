import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { connectLogin, serveLogin, type LoginPort } from '../lib/login/connection';
import { createLoginService } from '../lib/login/service';
import type { LoginView } from '../lib/login/state';
import { createFakeAuth, isFakeScenario } from '../lib/telegram/fake';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-31T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

type End = {
  port: LoginPort;
  received: unknown[];
  message: Set<(message: unknown) => void>;
  disconnect: Set<() => void>;
};

function end(): End {
  const message = new Set<(message: unknown) => void>();
  const disconnect = new Set<() => void>();
  return {
    received: [],
    message,
    disconnect,
    port: {
      name: 'login',
      postMessage() {},
      onMessage: { addListener: (listener) => void message.add(listener) },
      onDisconnect: { addListener: (listener) => void disconnect.add(listener) },
    },
  };
}

// The browser's runtime is the border: a page port and a worker port joined like Chrome joins
// them, each message a JSON copy that arrives later and in order.
function fakeRuntime() {
  let accept: ((port: LoginPort) => void) | null = null;
  const pairs: { page: End; worker: End; open: boolean }[] = [];

  function join(from: End, to: End, pair: { open: boolean }) {
    from.port.postMessage = (message) => {
      const copy: unknown = JSON.parse(JSON.stringify(message));
      queueMicrotask(() => {
        if (!pair.open) return;
        to.received.push(copy);
        for (const listener of to.message) listener(copy);
      });
    };
  }

  function pairAt(n: number) {
    const pair = pairs[n];
    if (!pair) throw new Error(`no port ${n}`);
    return pair;
  }

  return {
    onConnect(listener: (port: LoginPort) => void) {
      accept = listener;
    },
    connect(): LoginPort {
      const pair = { page: end(), worker: end(), open: true };
      join(pair.page, pair.worker, pair);
      join(pair.worker, pair.page, pair);
      pairs.push(pair);
      accept?.(pair.worker.port);
      return pair.page.port;
    },
    /** What the worker side of the port opened n-th got, in order. */
    received(n: number) {
      return pairAt(n).worker.received;
    },
    /** A tab closes: the worker side hears it. */
    close(n: number) {
      const pair = pairAt(n);
      pair.open = false;
      for (const listener of pair.worker.disconnect) listener();
    },
    /** The background restarts: both sides of every open port hear it. */
    drop() {
      for (const pair of pairs.filter((p) => p.open)) {
        pair.open = false;
        for (const listener of pair.worker.disconnect) listener();
        for (const listener of pair.page.disconnect) listener();
      }
    },
  };
}

const load = (scenario?: string) =>
  Promise.resolve(
    createLoginService(
      createFakeAuth({ scenario: isFakeScenario(scenario) ? scenario : 'default' }),
      'Chromium on Linux',
    ),
  );

function tab(runtime: ReturnType<typeof fakeRuntime>, scenario?: string) {
  const connection = connectLogin({ connect: runtime.connect, scenario });
  const views: LoginView[] = [];
  connection.subscribe((view) => views.push(view));
  return { connection, views };
}

function qrUrl(views: LoginView[]) {
  const login = views.at(-1)?.login;
  return login?.step === 'qr' ? login.code?.url : login?.step;
}

describe('two tabs', () => {
  test('a tab that opens late gets the same QR code at once', async () => {
    // Given: tab 1 shows the first QR code
    const runtime = fakeRuntime();
    serveLogin(load, { fake: false, onConnect: runtime.onConnect });
    tab(runtime).connection.send({ type: 'hello' });
    await advance(0);
    // When: tab 2 connects and says hello
    const second = tab(runtime);
    second.connection.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(
      second.views.map((v) => (v.login.step === 'qr' ? v.login.code?.url : v.login.step)),
    ).toEqual(['tg://login?token=fake-1']);
  });

  test('a tab that opens after every tab closed gets a new QR code', async () => {
    // Given: one tab saw the first QR code, then every tab closed
    const runtime = fakeRuntime();
    serveLogin(load, { fake: false, onConnect: runtime.onConnect });
    tab(runtime).connection.send({ type: 'hello' });
    await advance(0);
    runtime.close(0);
    await advance(0);
    // When: a new tab connects and says hello
    const second = tab(runtime);
    second.connection.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(qrUrl(second.views)).toBe('tg://login?token=fake-2');
  });
});

describe('fake scenario', () => {
  test('the fake build starts the scenario the page names', async () => {
    // Given: a fake build, a page opened with ?fake=qr-scan
    const runtime = fakeRuntime();
    serveLogin(load, { fake: true, onConnect: runtime.onConnect });
    const page = tab(runtime, 'qr-scan');
    // When
    page.connection.send({ type: 'hello' });
    await advance(3_000);
    // Then
    expect(page.views.at(-1)?.login).toEqual({
      step: 'done',
      account: { id: 7100, name: 'Linh Vu', initials: 'LV' },
      device: 'Chromium on Linux',
      logout: 'idle',
    });
  });

  test('the real build ignores a scenario', async () => {
    // Given: a real build, a page opened with ?fake=qr-scan
    const runtime = fakeRuntime();
    serveLogin(load, { fake: false, onConnect: runtime.onConnect });
    const page = tab(runtime, 'qr-scan');
    // When
    page.connection.send({ type: 'hello' });
    await advance(3_000);
    // Then
    expect(qrUrl(page.views)).toBe('tg://login?token=fake-1');
  });
});

describe('port', () => {
  test('the page sends a keep-alive every 20 s', async () => {
    // Given: a tab said hello
    const runtime = fakeRuntime();
    serveLogin(load, { fake: false, onConnect: runtime.onConnect });
    tab(runtime).connection.send({ type: 'hello' });
    await advance(0);
    // When
    await advance(20_000);
    // Then
    expect(runtime.received(0)).toEqual([
      { kind: 'command', command: { type: 'hello' } },
      { kind: 'keepAlive' },
    ]);
  });

  test('a reconnect says hello again', async () => {
    // Given: a tab said hello
    const runtime = fakeRuntime();
    serveLogin(load, { fake: false, onConnect: runtime.onConnect });
    tab(runtime).connection.send({ type: 'hello' });
    // When: the background restarts
    runtime.drop();
    await advance(500);
    // Then
    expect(runtime.received(1)).toEqual([{ kind: 'command', command: { type: 'hello' } }]);
  });
});
