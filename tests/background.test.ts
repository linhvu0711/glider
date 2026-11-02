import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { connectChats } from '../lib/chats/connection';
import { connectSend } from '../lib/send/connection';
import type { Page } from '../lib/send/state';
import { saveTargetChat } from '../lib/target-chat';
import { FAKE_CHATS, LINH, MINH } from '../lib/telegram/fake';

const READ_LATER = FAKE_CHATS.find((chat) => chat.name === 'Read Later Bot')!;
const EXAMPLE: Page = { url: 'https://example.com/', title: 'Example Domain', icon: null };

let onConnect: ((port: unknown) => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
  vi.stubEnv('WXT_TELEGRAM', 'fake');
  // The fake browser has no runtime.connect; a case that needs the login port gives one itself.
  vi.spyOn(fakeBrowser.runtime.onConnect, 'addListener').mockImplementation((listener) => {
    onConnect = listener as never;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function startBackground() {
  await storage.setItem('local:fakeSession', LINH);
  await saveTargetChat(LINH.id, READ_LATER);
  const background = (await import('../entrypoints/background')).default;
  background.main();
}

describe('the background', () => {
  test("a popup's send reaches the background", async () => {
    // Given: the background runs the fake build, Linh is logged in, Read Later Bot is saved
    await startBackground();
    // When
    const opened = await connectSend().open(EXAMPLE);
    // Then
    expect(opened).toEqual({ kind: 'added', chat: READ_LATER, id: expect.any(String) });
  });

  test("a page's chat list reaches the background", async () => {
    // Given: as above
    await startBackground();
    // When
    const names = await vi.waitFor(async () =>
      (await connectChats().list()).map((chat) => chat.name),
    );
    // Then
    expect(names).toEqual([
      'Saved Messages',
      'Read Later Bot',
      'Tuan Vu',
      'Minh Anh',
      'Design Crew',
      'Hermes',
      'Glider News',
    ]);
  });

  test('a fake scenario reaches the chat list', async () => {
    // Given: the background runs the fake build, with a settings page on its login port
    const background = (await import('../entrypoints/background')).default;
    background.main();
    const listeners: ((message: unknown) => void)[] = [];
    onConnect!({
      name: 'login',
      onMessage: { addListener: (listener: (message: unknown) => void) => listeners.push(listener) },
      onDisconnect: { addListener: () => {} },
      postMessage: () => {},
    });
    // When: the page picks chats-error, Minh Anh logs in again, and the list loads twice
    for (const listener of listeners) listener({ kind: 'scenario', name: 'chats-error' });
    await vi.advanceTimersByTimeAsync(0);
    // A new scenario starts logged out: it removes the fake session.
    await storage.setItem('local:fakeSession', MINH);
    const chats = connectChats();
    const first = chats.list().then(
      () => 'listed',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const second = chats.list().then((list) => list.length);
    await vi.advanceTimersByTimeAsync(0);
    // Then
    expect([await first, await second]).toEqual(['chats', 7]);
  });
});
