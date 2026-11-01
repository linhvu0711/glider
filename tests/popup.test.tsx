import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { storage } from 'wxt/utils/storage';
import Popup from '../entrypoints/popup/Popup';
import { answerSend, connectSend } from '../lib/send/connection';
import { createSendService } from '../lib/send/service';
import type { Page } from '../lib/send/state';
import { createFakeChats, createFakeSend, FAKE_CHATS, LINH } from '../lib/telegram/fake';

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

async function setUp({ saved = true }: { saved?: boolean } = {}) {
  await storage.setItem('local:fakeSession', LINH);
  if (saved) await storage.setItem('local:targetChat', { account: LINH.id, chat: READ_LATER });
  const telegram = createFakeSend();
  const service = createSendService(telegram);
  await service.start();
  const sender = connectSend((request) => answerSend(service)(request)!);
  const openSettings = vi.fn();
  const close = vi.fn();
  // Each call is one popup open: it sends the page once, as entrypoints/popup/main.tsx does.
  function renderPopup(page: Page | null) {
    return render(
      <Popup
        sender={sender}
        opened={sender.open(page)}
        chats={createFakeChats({ scenario: 'default' })}
        openSettings={openSettings}
        close={close}
      />,
    );
  }
  return { telegram, sender, openSettings, close, renderPopup };
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

  test('shows Not sent with Remove', async () => {
    // Given: Linh Vu logged in, Read Later Bot saved
    const { renderPopup } = await setUp();
    const user = setupUser();
    // When: the account logs out while the link waits
    renderPopup(EXAMPLE);
    await advance(2_000);
    await storage.setItem('local:fakeSession', null);
    await advance(3_000);
    const failed = !!screen.queryByText('Not sent');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await advance(0);
    // Then
    expect([failed, !!screen.queryByText('Nothing waiting')]).toEqual([true, true]);
  });
});
