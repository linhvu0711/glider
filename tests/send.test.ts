import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { storage } from 'wxt/utils/storage';
import { answerSend, connectSend } from '../lib/send/connection';
import { createSendService } from '../lib/send/service';
import type { Page, Sends } from '../lib/send/state';
import type { Account } from '../lib/telegram/auth';
import { createFakeSend, FAKE_CHATS, LINH } from '../lib/telegram/fake';

const READ_LATER = FAKE_CHATS.find((chat) => chat.name === 'Read Later Bot')!;
const EXAMPLE: Page = { url: 'https://example.com/', title: 'Example Domain', icon: null };
const EXAMPLE_ORG: Page = { url: 'https://example.org/', title: 'Example Domain', icon: null };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

async function setUp({
  account = LINH,
  saved = true,
}: { account?: Account | null; saved?: boolean } = {}) {
  await storage.setItem('local:fakeSession', account);
  if (saved) await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
  const telegram = createFakeSend();
  const service = createSendService(telegram);
  await service.start();
  const sender = connectSend((request) => answerSend(service)(request)!);
  return { telegram, service, sender };
}

async function links() {
  return (await storage.getItem<Sends>('session:links'))?.links ?? [];
}

async function statuses() {
  return (await links()).map((link) => link.status);
}

describe('send', () => {
  test('sends the page link 5 s after a send', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved, fake timers at 2026-11-01T10:00:00Z
    const { telegram, sender } = await setUp();
    // When
    const opened = await sender.open(EXAMPLE);
    await advance(4_999);
    const early = telegram.sent.length;
    await advance(1);
    // Then
    expect([opened.kind, early, telegram.sent]).toEqual([
      'added',
      0,
      [{ chat: 7001, text: 'https://example.com/' }],
    ]);
  });

  test('keeps the waiting link in session storage', async () => {
    // Given: as above
    const { sender } = await setUp();
    // When
    await sender.open(EXAMPLE);
    await advance(0);
    // Then
    expect(await storage.getItem('session:links')).toEqual({
      links: [
        {
          id: expect.any(String),
          page: { url: 'https://example.com/', title: 'Example Domain', icon: null },
          account: 7100,
          chat: READ_LATER,
          sendAt: Date.parse('2026-11-01T10:00:05Z'),
          status: 'waiting',
        },
      ],
      times: [Date.parse('2026-11-01T10:00:00Z')],
    });
  });

  test('removes a sent link after 2.5 s', async () => {
    // Given: as above
    const { sender } = await setUp();
    // When
    await sender.open(EXAMPLE);
    await advance(5_000);
    const sent = await statuses();
    await advance(2_500);
    // Then
    expect([sent, await statuses()]).toEqual([['sent'], []]);
  });

  test('sends two pages, each after its own 5 s', async () => {
    // Given: as above
    const { telegram, sender } = await setUp();
    const texts = () => telegram.sent.map((message) => message.text);
    // When
    await sender.open(EXAMPLE);
    await advance(2_000);
    await sender.open(EXAMPLE_ORG);
    await advance(3_000);
    const first = texts();
    await advance(2_000);
    // Then
    expect([first, texts()]).toEqual([
      ['https://example.com/'],
      ['https://example.com/', 'https://example.org/'],
    ]);
  });

  test('asks to set up when no chat is saved', async () => {
    // Given: Linh Vu logged in, nothing in local:targetChat
    const { telegram, sender } = await setUp({ saved: false });
    // When
    const opened = await sender.open(EXAMPLE);
    await advance(10_000);
    // Then
    expect([opened, await links(), telegram.sent]).toEqual([{ kind: 'setup' }, [], []]);
  });

  test('asks to set up when no one is logged in', async () => {
    // Given: no saved session, Read Later Bot saved for Linh Vu
    const { sender } = await setUp({ account: null });
    // When
    const opened = await sender.open(EXAMPLE);
    // Then
    expect(opened).toEqual({ kind: 'setup' });
  });
});
