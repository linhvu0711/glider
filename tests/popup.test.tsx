import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { storage } from 'wxt/utils/storage';
import Popup from '../entrypoints/popup/Popup';
import { memoryPath, served } from '../lib/messages';
import { connectSend, sendGroup } from '../lib/send/connection';
import { createSendService } from '../lib/send/service';
import type { Page } from '../lib/send/state';
import { createFakeChats, createFakeSend, FAKE_CHATS, LINH, type FakeSend } from '../lib/telegram/fake';
import { SendError, type TelegramSend } from '../lib/telegram/send';

const READ_LATER = FAKE_CHATS.find((chat) => chat.name === 'Read Later Bot')!;
const EXAMPLE: Page = { url: 'https://example.com/', title: 'Example Domain', icon: null };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setupUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

async function setUp({
  saved = true,
  telegram = createFakeSend(),
}: { saved?: boolean; telegram?: FakeSend | TelegramSend } = {}) {
  await storage.setItem('local:fakeSession', LINH);
  if (saved) await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
  const service = createSendService(telegram);
  await service.start();
  const sender = connectSend(memoryPath([served(sendGroup, service)]));
  const openSettings = vi.fn();
  const openChatSettings = vi.fn();
  const close = vi.fn();
  // Each call is one popup open: it sends the page once, as entrypoints/popup/main.tsx does.
  function renderPopup(page: Page | null) {
    return render(
      <Popup
        sender={sender}
        opened={sender.open(page)}
        chats={createFakeChats({ scenario: 'default' })}
        openSettings={openSettings}
        openChatSettings={openChatSettings}
        close={close}
      />,
    );
  }
  return {
    telegram: telegram as FakeSend,
    sender,
    openSettings,
    openChatSettings,
    close,
    renderPopup,
  };
}

function rowOf(address: string) {
  return screen.getByText(address).closest('li') as HTMLElement;
}

describe('popup', () => {
  test('shows the new page waiting with Undo in focus', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved, fake timers at 2026-11-01T10:00:00Z
    const { renderPopup } = await setUp();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    // Then
    const row = rowOf('example.com');
    expect([
      row.textContent?.includes('Example Domain'),
      !!screen.getByText('example.com'),
      row.textContent?.includes('Sending in 5 s'),
      document.activeElement?.textContent,
      (screen.getByTestId('drain-bar') as HTMLElement).style.animationDuration,
    ]).toEqual([true, true, true, 'Undo', '5000ms']);
  });

  test('counts down each second', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    await advance(1_000);
    // Then
    expect(screen.getByText('Sending in 4 s')).toBeTruthy();
  });

  test('Enter presses Undo', async () => {
    // Given: as above
    const { telegram, renderPopup } = await setUp();
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    await user.keyboard('{Enter}');
    await advance(0);
    const undone = !!screen.queryByText('Undone. Nothing was sent.');
    await advance(10_000);
    // Then
    expect([undone, telegram.sent]).toEqual([true, []]);
  });

  test('shows the chat, the gear, and the shortcut', async () => {
    // Given: as above
    const { openSettings, renderPopup } = await setUp();
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    // Then
    expect([
      !!screen.getByText('Sending to') && !!screen.getByText('Read Later Bot'),
      !!screen.getByText('Sending to').closest('header')?.querySelector('.chat-avatar'),
      screen.getByLabelText('Ctrl+Shift+S').getAttribute('aria-label'),
      !!screen.getByText('to send'),
      !!screen.getByText('5 s to undo'),
      openSettings.mock.calls.length,
    ]).toEqual([true, true, 'Ctrl+Shift+S', true, true, 1]);
  });
});

describe('popup states', () => {
  test('shows Sent to the chat, then nothing', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { renderPopup } = await setUp();
    // When
    renderPopup(EXAMPLE);
    await advance(5_000);
    const sent = !!screen.queryByText('Sent to Read Later Bot');
    await advance(2_500);
    // Then
    expect([sent, !!screen.queryByText('Nothing waiting')]).toEqual([true, true]);
  });

  test('Undo says nothing was sent', async () => {
    // Given: as above
    const { telegram, renderPopup } = await setUp();
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await advance(0);
    const undone = !!screen.queryByText('Undone. Nothing was sent.');
    await advance(2_500);
    const empty = !!screen.queryByText('Nothing waiting');
    await advance(10_000);
    // Then
    expect([undone, empty, telegram.sent]).toEqual([true, true, []]);
  });

  test('Esc closes the popup and the link still goes', async () => {
    // Given: as above
    const { telegram, close, renderPopup } = await setUp();
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    await user.keyboard('{Escape}');
    cleanup();
    await advance(5_000);
    // Then
    expect([close.mock.calls.length, telegram.sent]).toEqual([
      1,
      [{ chat: 7001, text: 'https://example.com/' }],
    ]);
  });

  test('shows two waiting pages', async () => {
    // Given: example.com sent at t = 0
    const { sender, renderPopup } = await setUp();
    await sender.open(EXAMPLE);
    // When
    await advance(1_000);
    renderPopup({ url: 'https://example.org/', title: 'Example Domain', icon: null });
    await advance(0);
    // Then
    const state = (address: string) => [
      address,
      rowOf(address).querySelector('.row-state')?.textContent,
    ];
    expect([
      state('example.org'),
      state('example.com'),
      screen.getAllByRole('button', { name: 'Undo' }).length,
    ]).toEqual([['example.org', 'Sending in 5 s'], ['example.com', 'Sending in 4 s'], 2]);
  });

  test('says the page is already waiting', async () => {
    // Given: example.com sent at t = 0
    const { sender, renderPopup } = await setUp();
    await sender.open(EXAMPLE);
    // When
    await advance(1_000);
    renderPopup(EXAMPLE);
    await advance(0);
    // Then
    expect([
      !!screen.queryByText('This page is already waiting. It was not added twice.'),
      screen.getAllByRole('listitem').length,
    ]).toEqual([true, 1]);
  });

  test('says to slow down after 10 sends in a minute', async () => {
    // Given: 10 sends 1 s apart from t = 0
    const { sender, renderPopup } = await setUp();
    for (let n = 1; n <= 10; n += 1) {
      await sender.open({ url: `https://example.com/?n=${n}`, title: 'Example Domain', icon: null });
      if (n < 10) await advance(1_000);
    }
    // When: at t = 10 s
    await advance(1_000);
    renderPopup({ url: 'https://example.com/?n=11', title: 'Example Domain', icon: null });
    await advance(0);
    // Then
    expect(
      screen.getByText('Slow down. You can send 10 links a minute. Try again in 50 s.'),
    ).toBeTruthy();
  });

  test('says nothing to send on a New Tab page', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { renderPopup } = await setUp();
    // When
    renderPopup(null);
    await advance(0);
    // Then
    expect([
      !!screen.queryByText('Nothing to send here'),
      !!screen.queryByText('Nothing to send on this page. Glider sends web pages only.'),
      !!screen.queryByText('Nothing waiting'),
    ]).toEqual([true, true, true]);
  });

  test('asks to set up Glider first', async () => {
    // Given: Linh Vu logged in, no chat saved
    const { openSettings, renderPopup } = await setUp({ saved: false });
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(0);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    // Then
    expect([
      !!screen.queryByText('Set up Glider first'),
      screen.queryByText('Sending to'),
      openSettings.mock.calls.length,
    ]).toEqual([true, null, 1]);
  });
});

// The fake fails a page whose address ends `#fail=<reason>` on its first send.
function failing(reason: string): Page {
  return { url: `https://example.com/#fail=${reason}`, title: 'Example Domain', icon: null };
}

describe('failed rows', () => {
  test('says no internet on a failed row', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved, fake timers at 2026-11-01T10:00:00Z
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('offline'));
    await advance(5_000);
    // Then
    expect([!!screen.queryByText('Not sent: no internet'), screen.queryByText('Not sent')]).toEqual([
      true,
      null,
    ]);
  });

  test('says you were logged out', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('logged-out'));
    await advance(5_000);
    // Then
    expect(!!screen.queryByText('Not sent: you were logged out')).toBe(true);
  });

  test('says you were logged out when the account left while it waited', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(EXAMPLE);
    await advance(2_000);
    await storage.setItem('local:fakeSession', null);
    await advance(3_000);
    // Then
    expect(!!screen.queryByText('Not sent: you were logged out')).toBe(true);
  });

  test("says it can't reach the chat", async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('unreachable'));
    await advance(5_000);
    // Then
    expect(!!screen.queryByText("Not sent: can't reach Read Later Bot")).toBe(true);
  });

  test('says Telegram asks to wait', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('wait-30'));
    await advance(5_000);
    // Then
    expect(!!screen.queryByText('Not sent: Telegram asks to wait')).toBe(true);
  });

  test('says something went wrong', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('other'));
    await advance(5_000);
    // Then
    expect(!!screen.queryByText('Not sent: something went wrong')).toBe(true);
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

function later(ms: number): () => Promise<void> {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}

describe('failed row actions', () => {
  test('shows Retry and Remove on a failed row', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('offline'));
    await advance(5_000);
    // Then
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect([
      retry.className,
      retry.disabled,
      !!screen.queryByRole('button', { name: 'Remove' }),
    ]).toEqual(['button row-button', false, true]);
  });

  test('Log in again opens the settings page', async () => {
    // Given: as above
    const { renderPopup, openSettings, openChatSettings } = await setUp();
    const user = setupUser();
    // When
    renderPopup(failing('logged-out'));
    await advance(5_000);
    await user.click(screen.getByRole('button', { name: 'Log in again' }));
    // Then
    expect([openSettings.mock.calls.length, openChatSettings.mock.calls.length]).toEqual([1, 0]);
  });

  test('Pick another chat opens settings at step 2', async () => {
    // Given: as above
    const { renderPopup, openSettings, openChatSettings } = await setUp();
    const user = setupUser();
    // When
    renderPopup(failing('unreachable'));
    await advance(5_000);
    await user.click(screen.getByRole('button', { name: 'Pick another chat' }));
    // Then
    expect([openSettings.mock.calls.length, openChatSettings.mock.calls.length]).toEqual([0, 1]);
  });

  test('counts down on the Retry button', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    renderPopup(failing('wait-30'));
    const read = () => {
      const button = within(rowOf('example.com')).getAllByRole('button')[0] as HTMLButtonElement;
      return [button.textContent, button.disabled];
    };
    await advance(5_000);
    const first = read();
    await advance(10_000);
    const second = read();
    await advance(20_000);
    // Then
    expect([first, second, read()]).toEqual([
      ['Retry in 30 s', true],
      ['Retry in 20 s', true],
      ['Retry', false],
    ]);
  });

  test('Retry shows Sending…, then Sent to the chat', async () => {
    // Given: a send that fails, then one that takes 1 s
    const { renderPopup } = await setUp({
      telegram: scripted(new SendError({ reason: 'offline' }), later(1_000)),
    });
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(5_000);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(0);
    const read = () => [
      !!screen.queryByText('Sending…'),
      !!screen.queryByText('Sent to Read Later Bot'),
    ];
    const during = read();
    await advance(1_000);
    // Then
    expect([during, read()]).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  test('Retry that fails again shows the reason again', async () => {
    // Given: a send that always fails with no internet
    const { renderPopup } = await setUp({
      telegram: scripted(new SendError({ reason: 'offline' }), new SendError({ reason: 'offline' })),
    });
    const user = setupUser();
    // When
    renderPopup(EXAMPLE);
    await advance(5_000);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(0);
    // Then
    expect([
      !!screen.queryByText('Not sent: no internet'),
      !!screen.queryByText('Sent to Read Later Bot'),
    ]).toEqual([true, false]);
  });

  test('Remove takes the row away and sends nothing', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { renderPopup, telegram } = await setUp();
    const user = setupUser();
    // When
    renderPopup(failing('offline'));
    await advance(5_000);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await advance(0);
    // Then
    expect([!!screen.queryByText('Nothing waiting'), telegram.sent]).toEqual([true, []]);
  });

  test('a failed row stays after the popup closes', async () => {
    // Given: as above
    const { renderPopup } = await setUp();
    // When
    const { unmount } = renderPopup(failing('offline'));
    await advance(5_000);
    unmount();
    await advance(60_000);
    renderPopup(null);
    await advance(0);
    // Then
    expect([
      !!screen.queryByText('Nothing to send here'),
      !!screen.queryByText('Not sent: no internet'),
    ]).toEqual([true, true]);
  });
});

describe('after a restart', () => {
  test('says Chrome closed first after a restart', async () => {
    // Given: a waiting link saved before Chrome closed; session storage is empty
    await storage.setItem('local:links', {
      links: [
        {
          id: 'a',
          page: EXAMPLE,
          account: LINH.id,
          chat: READ_LATER,
          sendAt: Date.parse('2026-11-01T10:00:03Z'),
          status: 'waiting',
        },
      ],
      times: [],
    });
    const { renderPopup } = await setUp();
    // When
    renderPopup(null);
    await advance(0);
    // Then
    expect([
      !!screen.queryByText('Not sent: Chrome closed first'),
      !!screen.queryByRole('button', { name: 'Retry' }),
    ]).toEqual([true, true]);
  });
});
