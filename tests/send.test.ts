import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { answerSend, connectSend } from '../lib/send/connection';
import { createSendService } from '../lib/send/service';
import type { Page, Sends } from '../lib/send/state';
import type { Account } from '../lib/telegram/auth';
import { createFakeSend, FAKE_CHATS, LINH, type FakeSend } from '../lib/telegram/fake';
import { SendError, type TelegramSend } from '../lib/telegram/send';

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
  telegram = createFakeSend(),
}: { account?: Account | null; saved?: boolean; telegram?: FakeSend | TelegramSend } = {}) {
  await storage.setItem('local:fakeSession', account);
  if (saved) await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
  const service = createSendService(telegram);
  await service.start();
  const sender = connectSend((request) => answerSend(service)(request)!);
  return { telegram: telegram as FakeSend, service, sender };
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

describe('worker wake-up and log out', () => {
  test('a new worker picks up the links that wait', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved; the store holds a waiting link due at
    // 10:00:03, a link in flight, and a sent link
    await storage.setItem('local:fakeSession', LINH);
    await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
    const link = (id: string, page: Page, status: string, sendAt: number) => ({
      id,
      page,
      account: LINH.id,
      chat: READ_LATER,
      sendAt,
      status,
    });
    await storage.setItem('session:links', {
      links: [
        link('a', EXAMPLE, 'waiting', Date.parse('2026-11-01T10:00:03Z')),
        link('b', EXAMPLE_ORG, 'sending', Date.parse('2026-11-01T09:59:59Z')),
        link(
          'c',
          { url: 'https://example.net/', title: 'Example Domain', icon: null },
          'sent',
          Date.parse('2026-11-01T09:59:58Z'),
        ),
      ],
      times: [],
    });
    const telegram = createFakeSend();
    const service = createSendService(telegram);
    // When
    await service.start();
    await service.start();
    await advance(3_000);
    // Then
    expect([
      (await links()).map((l) => [l.page.url, l.status]),
      telegram.sent.map((message) => message.text),
    ]).toEqual([
      [
        ['https://example.com/', 'sent'],
        ['https://example.org/', 'failed'],
      ],
      ['https://example.com/'],
    ]);
  });

  test('sends nothing when the account logged out while it waited', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { telegram, sender } = await setUp();
    // When
    await sender.open(EXAMPLE);
    await advance(2_000);
    await storage.setItem('local:fakeSession', null);
    await advance(3_000);
    // Then
    expect([await statuses(), telegram.sent]).toEqual([['failed'], []]);
  });

  test('Remove takes away a link that was not sent', async () => {
    // Given: a link that failed because the account logged out
    const { sender } = await setUp();
    const opened = await sender.open(EXAMPLE);
    await advance(2_000);
    await storage.setItem('local:fakeSession', null);
    await advance(3_000);
    // When
    if (opened.kind === 'added') await sender.remove(opened.id);
    await advance(0);
    // Then
    expect(await links()).toEqual([]);
  });
});

// The fake fails a page whose address ends `#fail=<reason>` on its first send.
function failing(reason: string): Page {
  return { url: `https://example.com/#fail=${reason}`, title: 'Example Domain', icon: null };
}

describe('failed sends', () => {
  test('keeps when Telegram lets it send again', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { sender } = await setUp();
    // When
    await sender.open(failing('wait-30'));
    await advance(5_000);
    // Then
    expect((await links())[0]).toMatchObject({
      status: 'failed',
      failure: { reason: 'wait', retryAt: Date.parse('2026-11-01T10:00:35Z') },
    });
  });

  test('says something went wrong for an error with no reason', async () => {
    // Given: as above, with a Telegram send that throws a plain error
    const { sender } = await setUp({
      telegram: {
        account: async () => LINH.id,
        sendText: async () => {
          throw new Error('boom');
        },
      },
    });
    // When
    await sender.open(EXAMPLE);
    await advance(5_000);
    // Then
    const [link] = await links();
    expect(link?.status === 'failed' ? link.failure : null).toEqual({ reason: 'other' });
  });

  test('keeps a failed link until Retry or Remove', async () => {
    // Given: as the wait test
    const { sender } = await setUp();
    // When
    await sender.open(failing('offline'));
    await advance(60_000);
    // Then
    expect(await statuses()).toEqual(['failed']);
  });

  test('the fake fails a #fail page once, then sends it', async () => {
    // Given
    const telegram = createFakeSend();
    // When
    const first = await telegram
      .sendText(READ_LATER.id, 'https://example.com/#fail=offline')
      .catch((e: SendError) => e.failure);
    await telegram.sendText(READ_LATER.id, 'https://example.com/#fail=offline');
    // Then
    expect([first, telegram.sent.map((m) => m.text)]).toEqual([
      { reason: 'offline' },
      ['https://example.com/#fail=offline'],
    ]);
  });
});

// A Telegram send that answers each call with the next entry: an error is thrown,
// a function is called and awaited.
function scripted(...answers: (SendError | (() => Promise<void>))[]): TelegramSend {
  return {
    account: async () => LINH.id,
    sendText: async () => {
      const answer = answers.shift();
      if (answer instanceof SendError) throw answer;
      await answer?.();
    },
  };
}

async function failedId(sender: Awaited<ReturnType<typeof setUp>>['sender'], page: Page) {
  const opened = await sender.open(page);
  await advance(5_000);
  if (opened.kind !== 'added') throw new Error(`not added: ${opened.kind}`);
  return opened.id;
}

describe('retry', () => {
  test('Retry sends a failed link at once', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved; a link for #fail=offline failed at 10:00:05
    const { telegram, sender } = await setUp();
    const id = await failedId(sender, failing('offline'));
    // When
    await sender.retry(id);
    await advance(0);
    // Then
    expect([await statuses(), telegram.sent.map((m) => m.text)]).toEqual([
      ['sent'],
      ['https://example.com/#fail=offline'],
    ]);
  });

  test('Retry shows sending first', async () => {
    // Given: a send that fails, then one that waits until the test lets it go
    const { sender } = await setUp({
      telegram: scripted(new SendError({ reason: 'offline' }), () => new Promise<void>(() => {})),
    });
    const id = await failedId(sender, EXAMPLE);
    // When
    await sender.retry(id);
    await advance(0);
    // Then
    expect(await statuses()).toEqual(['sending']);
  });

  test('Retry that fails again keeps the new reason', async () => {
    // Given: a send that fails with no internet, then with a chat it cannot reach
    const { sender } = await setUp({
      telegram: scripted(
        new SendError({ reason: 'offline' }),
        new SendError({ reason: 'unreachable' }),
      ),
    });
    const id = await failedId(sender, EXAMPLE);
    // When
    await sender.retry(id);
    await advance(0);
    // Then
    expect((await links())[0]).toMatchObject({ status: 'failed', failure: { reason: 'unreachable' } });
  });

  test('Retry before the wait is over does nothing', async () => {
    // Given: a link for #fail=wait-30 failed at 10:00:05
    const { telegram, sender } = await setUp();
    const id = await failedId(sender, failing('wait-30'));
    // When
    await advance(15_000);
    await sender.retry(id);
    await advance(0);
    const early = [await statuses(), telegram.sent.map((m) => m.text)];
    await advance(15_000);
    await sender.retry(id);
    await advance(0);
    // Then
    expect([...early, await statuses()]).toEqual([['failed'], [], ['sent']]);
  });

  test('Retry after a log out says logged out', async () => {
    // Given: a link for #fail=offline failed at 10:00:05, then the account logged out
    const { telegram, sender } = await setUp();
    const id = await failedId(sender, failing('offline'));
    await storage.setItem('local:fakeSession', null);
    // When
    await sender.retry(id);
    await advance(0);
    // Then
    const [link] = await links();
    expect([link?.status === 'failed' ? link.failure : null, telegram.sent]).toEqual([
      { reason: 'logged-out' },
      [],
    ]);
  });
});
