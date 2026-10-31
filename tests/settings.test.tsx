import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../entrypoints/options/App';
import { connectInMemory } from '../lib/login/connection';
import { createLoginService } from '../lib/login/service';
import { createFakeAuth, type FakeScenario } from '../lib/telegram/fake';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-31T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderApp(scenario: FakeScenario, device = 'Chromium on Linux') {
  const auth = createFakeAuth({ scenario });
  const service = createLoginService(auth, device);
  render(<App connection={connectInMemory(service)} />);
  return { auth, service };
}

function fullText(text: string) {
  return screen.getByText(
    (_, el) =>
      el !== null &&
      el.textContent === text &&
      !Array.from(el.children).some((child) => child.textContent === text),
  );
}

function qrBox() {
  return screen.getByLabelText('QR code');
}

describe('header', () => {
  test('shows Not logged in in the header', () => {
    // Given: <App /> rendered with no connection yet
    // When
    render(<App />);
    // Then
    expect(screen.getByRole('heading', { name: 'Glider' })).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Not logged in')).toBeTruthy();
    expect(
      screen.getByText(
        'Glider sends from your own Telegram account. Your login stays on this computer.',
      ),
    ).toBeTruthy();
  });
});

describe('QR login', () => {
  test('shows a QR code with three steps', async () => {
    // Given: fake scenario default, fake timers at 2026-10-31T10:00:00Z
    // When: render <App>, let the first code arrive
    renderApp('default');
    await advance(0);
    // Then
    expect(qrBox().querySelector('svg')).toBeTruthy();
    expect(fullText('Open Telegram on your phone.')).toBeTruthy();
    expect(fullText('Go to Settings → Devices → Link Desktop Device.')).toBeTruthy();
    expect(fullText('Point your phone at this code.')).toBeTruthy();
    expect(screen.getByText('New code in 0:30')).toBeTruthy();
  });

  test('counts down and shows a fresh code at 0', async () => {
    // Given: as above
    renderApp('default');
    await advance(0);
    // When: advance 10 s, read the text; advance 20 s more
    await advance(10_000);
    const afterTen = screen.queryByText('New code in 0:20');
    await advance(20_000);
    // Then
    expect(afterTen).toBeTruthy();
    expect(qrBox().querySelector('svg')?.getAttribute('data-value')).toBe(
      'tg://login?token=fake-2',
    );
    expect(screen.getByText('New code in 0:30')).toBeTruthy();
  });

  test('shows the loading box until the first code', async () => {
    // Given: fake scenario slow (first code after 5 s), fake timers
    // When: render <App>, advance 1 s
    renderApp('slow');
    await advance(1_000);
    // Then
    expect(within(qrBox()).getByText('Getting a code…')).toBeTruthy();
    expect(qrBox().querySelector('svg')).toBeNull();
  });
});
