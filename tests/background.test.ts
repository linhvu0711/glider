import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { connectChats } from '../lib/chats/connection';
import { connectSend } from '../lib/send/connection';
import type { Page } from '../lib/send/state';
import { FAKE_CHATS, LINH } from '../lib/telegram/fake';

const READ_LATER = FAKE_CHATS.find((chat) => chat.name === 'Read Later Bot')!;
const EXAMPLE: Page = { url: 'https://example.com/', title: 'Example Domain', icon: null };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
  vi.stubEnv('WXT_TELEGRAM', 'fake');
  // The fake browser has no runtime.connect; the login port is not under test here.
  vi.spyOn(fakeBrowser.runtime.onConnect, 'addListener').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function startBackground() {
  await storage.setItem('local:fakeSession', LINH);
  await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
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
});
