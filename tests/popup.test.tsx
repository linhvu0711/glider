import { act, render, screen } from '@testing-library/react';
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
