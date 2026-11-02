import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { memoryPath, served } from '../lib/messages';
import { connectSend, sendGroup } from '../lib/send/connection';
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
  const sender = connectSend(memoryPath([served(sendGroup, service)]));
  return { telegram: telegram as FakeSend, service, sender };
}

async function links() {
  return (await storage.getItem<Sends>('local:links'))?.links ?? [];
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

  test('keeps the waiting link in local storage', async () => {
    // Given: as above
    const { sender } = await setUp();
    // When
    await sender.open(EXAMPLE);
    await advance(0);
    // Then
    expect(await storage.getItem('local:links')).toEqual({
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
    await storage.setItem('session:browserOpen', true);
    await storage.setItem('local:links', {
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
      .sendText(READ_LATER.id, 'https://example.com/#fail=offline', 'k')
      .catch((e: SendError) => e.failure);
    await telegram.sendText(READ_LATER.id, 'https://example.com/#fail=offline', 'k');
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

describe('red badge', () => {
  test('shows a red ! while a link is failed', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { sender } = await setUp();
    const color = vi.spyOn(fakeBrowser.action, 'setBadgeBackgroundColor');
    const badge = () => fakeBrowser.action.getBadgeText({});
    // When
    const id = await failedId(sender, failing('offline'));
    const failed = [await badge(), color.mock.lastCall];
    await sender.remove(id);
    await advance(0);
    // Then
    expect([...failed, await badge()]).toEqual(['!', [{ color: '#dc2626' }], '']);
  });

  test('a waiting count wins over the red !', async () => {
    // Given: a link for #fail=offline failed at 10:00:05
    const { sender } = await setUp();
    await failedId(sender, failing('offline'));
    const badge = () => fakeBrowser.action.getBadgeText({});
    // When
    await sender.open(EXAMPLE_ORG);
    await advance(0);
    const waiting = await badge();
    await advance(5_000);
    const sent = await badge();
    await advance(2_000);
    // Then
    expect([waiting, sent, await badge()]).toEqual(['1', '✓', '!']);
  });
});

describe('notifications', () => {
  test('says why in a notification', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { sender } = await setUp();
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    // When
    for (const url of [
      'https://example.com/#fail=offline',
      'https://example.org/#fail=logged-out',
      'https://example.net/#fail=unreachable',
      'https://example.com/?flood#fail=wait-30',
      'https://example.org/?other#fail=other',
    ]) {
      await sender.open({ url, title: 'Example Domain', icon: null });
    }
    await advance(5_000);
    // Then
    const shown = create.mock.calls.map((call) => {
      const options = call[1] as unknown as { title: string; message: string; contextMessage: string };
      return [options.title, options.message, options.contextMessage];
    });
    expect([
      [...shown].sort(),
      (create.mock.calls[0]?.[1] as unknown as { iconUrl: string } | undefined)?.iconUrl,
    ]).toEqual([
      [
        ['Glider', "Can't send to Read Later Bot. It may be deleted, stopped, or blocked.", 'example.net'],
        ['Glider', 'Not sent: no internet.', 'example.com'],
        ['Glider', 'Not sent: something went wrong.', 'example.org?other'],
        ['Glider', 'Not sent: you were logged out.', 'example.org'],
        ['Glider', 'Telegram asks to wait 30 s.', 'example.com?flood'],
      ],
      'chrome-extension://test-extension-id/icons/128.png',
    ]);
  });

  test('Remove clears its notification', async () => {
    // Given: a link for #fail=offline failed at 10:00:05
    const { sender } = await setUp();
    const id = await failedId(sender, failing('offline'));
    const shown = Object.keys(await fakeBrowser.notifications.getAll()).length;
    // When
    await sender.remove(id);
    await advance(0);
    // Then
    expect([shown, await fakeBrowser.notifications.getAll()]).toEqual([1, {}]);
  });

  test('a second failure of one link shows one notification', async () => {
    // Given: a send that always fails with no internet; the link failed at 10:00:05
    const { sender } = await setUp({
      telegram: scripted(new SendError({ reason: 'offline' }), new SendError({ reason: 'offline' })),
    });
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    const id = await failedId(sender, EXAMPLE);
    // When
    await sender.retry(id);
    await advance(0);
    // Then
    expect([
      Object.keys(await fakeBrowser.notifications.getAll()).length,
      create.mock.calls.length,
    ]).toEqual([1, 2]);
  });
});

describe('Chrome restart', () => {
  // A waiting link due at 10:00:03 and a link that failed earlier, saved before Chrome closed.
  async function savedBeforeClose() {
    await storage.setItem('local:fakeSession', LINH);
    await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
    const base = { account: LINH.id, chat: READ_LATER };
    await storage.setItem('local:links', {
      links: [
        { ...base, id: 'a', page: EXAMPLE, sendAt: Date.parse('2026-11-01T10:00:03Z'), status: 'waiting' },
        {
          ...base,
          id: 'b',
          page: EXAMPLE_ORG,
          sendAt: Date.parse('2026-11-01T09:59:00Z'),
          status: 'failed',
          failure: { reason: 'unreachable' },
        },
      ],
      times: [],
    });
  }

  test('a link that waited when Chrome closed comes back as not sent', async () => {
    // Given: the links saved before Chrome closed; session storage is empty, as after a restart
    await savedBeforeClose();
    const telegram = createFakeSend();
    const service = createSendService(telegram);
    // When
    await service.start();
    await advance(5_000);
    // Then
    expect([
      (await links()).map((l) => [l.page.url, l.status, l.status === 'failed' ? l.failure : null]),
      telegram.sent,
    ]).toEqual([
      [
        ['https://example.com/', 'failed', { reason: 'closed' }],
        ['https://example.org/', 'failed', { reason: 'unreachable' }],
      ],
      [],
    ]);
  });

  test('starting twice after a restart changes nothing more', async () => {
    // Given: as above
    await savedBeforeClose();
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    const telegram = createFakeSend();
    const service = createSendService(telegram);
    // When
    await service.start();
    await service.start();
    await advance(5_000);
    // Then
    expect([await statuses(), create.mock.calls.length, telegram.sent]).toEqual([
      ['failed', 'failed'],
      1,
      [],
    ]);
  });
});
