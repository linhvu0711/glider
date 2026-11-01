import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
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

describe('undo', () => {
  test('Undo in time sends nothing', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { telegram, sender } = await setUp();
    // When
    const opened = await sender.open(EXAMPLE);
    await advance(3_000);
    if (opened.kind === 'added') await sender.undo(opened.id);
    await advance(0);
    const undone = await statuses();
    await advance(2_500);
    const after = await statuses();
    await advance(10_000);
    // Then
    expect([undone, after, telegram.sent]).toEqual([['undone'], [], []]);
  });

  test('Undo after the send changes nothing', async () => {
    // Given: as above
    const { telegram, sender } = await setUp();
    // When
    const opened = await sender.open(EXAMPLE);
    await advance(5_000);
    if (opened.kind === 'added') await sender.undo(opened.id);
    await advance(0);
    // Then
    expect([await statuses(), telegram.sent.length]).toEqual([['sent'], 1]);
  });
});

describe('a page that waits', () => {
  test('adds no second row for a page that waits', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { telegram, sender } = await setUp();
    // When
    const first = await sender.open(EXAMPLE);
    await advance(1_000);
    const second = await sender.open(EXAMPLE);
    const rows = (await links()).length;
    await advance(4_000);
    // Then
    expect([
      second.kind,
      first.kind === 'added' && second.kind === 'already' && second.id === first.id,
      rows,
      telegram.sent.length,
    ]).toEqual(['already', true, 1, 1]);
  });
});

describe('send limit', () => {
  async function tenSends(sender: Awaited<ReturnType<typeof setUp>>['sender']) {
    for (let n = 1; n <= 10; n += 1) {
      await sender.open({ url: `https://example.com/?n=${n}`, title: 'Example Domain', icon: null });
      if (n < 10) await advance(1_000);
    }
  }

  test('the 11th send in a minute adds nothing', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved, 10 sends 1 s apart from t = 0
    const { sender } = await setUp();
    await tenSends(sender);
    // When: at t = 10 s
    await advance(1_000);
    const opened = await sender.open({
      url: 'https://example.com/?n=11',
      title: 'Example Domain',
      icon: null,
    });
    // Then
    expect([
      opened,
      (await links()).some((link) => link.page.url === 'https://example.com/?n=11'),
    ]).toEqual([{ kind: 'limit', chat: READ_LATER, seconds: 50 }, false]);
  });

  test('sends again once the first send is a minute old', async () => {
    // Given: as above
    const { sender } = await setUp();
    await tenSends(sender);
    // When: at t = 60 s
    await advance(51_000);
    const opened = await sender.open({
      url: 'https://example.com/?n=11',
      title: 'Example Domain',
      icon: null,
    });
    // Then
    expect(opened.kind).toBe('added');
  });
});

describe('not a web page', () => {
  test('says pages that are not web pages have nothing to send', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { sender } = await setUp();
    // When: no page, a New Tab page, a file
    const kinds = [
      (await sender.open(null)).kind,
      (await sender.open({ url: 'chrome://newtab/', title: 'New Tab', icon: null })).kind,
      (await sender.open({ url: 'file:///home/linh/notes.txt', title: 'notes.txt', icon: null }))
        .kind,
    ];
    // Then
    expect([kinds, await links()]).toEqual([['not-web', 'not-web', 'not-web'], []]);
  });
});

describe('badge', () => {
  test('counts waiting links on the badge, then shows a check', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { sender } = await setUp();
    const badge = () => fakeBrowser.action.getBadgeText({});
    // When
    await sender.open(EXAMPLE);
    await sender.open(EXAMPLE_ORG);
    await advance(0);
    const waiting = await badge();
    await advance(5_000);
    const sent = await badge();
    await advance(2_000);
    // Then
    expect([waiting, sent, await badge()]).toEqual(['2', '✓', '']);
  });
});
