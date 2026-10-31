import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function setupUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

type User = ReturnType<typeof setupUser>;

async function openPhoneStep(user: User) {
  await user.click(screen.getByRole('button', { name: 'Log in with phone number instead' }));
}

async function toCodeStep(
  user: User,
  { scenario = 'default', number = '912 345 678' }: { scenario?: FakeScenario; number?: string } = {},
) {
  const ctx = renderApp(scenario);
  await advance(0);
  await openPhoneStep(user);
  await user.type(screen.getByLabelText('Phone number'), number);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await advance(scenario === 'slow' ? 5_000 : 0);
  return ctx;
}

function digit(n: number) {
  return screen.getByLabelText(`Digit ${n}`) as HTMLInputElement;
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

describe('logged in', () => {
  test('shows Done and the account row after a scan', async () => {
    // Given: fake scenario qr-scan (scanned 3 s after the first code, account Linh Vu), device Brave on macOS
    renderApp('qr-scan', 'Brave on macOS');
    // When: render, advance 4 s
    await advance(4_000);
    // Then
    const card = within(screen.getByRole('region', { name: 'Log in to Telegram' }));
    expect(card.getByText('Done')).toBeTruthy();
    expect(card.getByText('LV')).toBeTruthy();
    expect(card.getByText('Linh Vu')).toBeTruthy();
    expect(
      card.getByText('Shown in Telegram as "Glider · Brave on macOS".'),
    ).toBeTruthy();
  });

  test('shows the account name in the header after login', async () => {
    // Given: as above
    renderApp('qr-scan', 'Brave on macOS');
    // When: render, advance 4 s
    await advance(4_000);
    // Then
    const header = within(screen.getByRole('banner'));
    expect(header.getByText('Linh Vu')).toBeTruthy();
    expect(header.queryByText('Not logged in')).toBeNull();
  });
});

describe('phone login', () => {
  test('shows the phone field with +84 and the hint', async () => {
    // Given: fake scenario default
    const user = setupUser();
    renderApp('default');
    await advance(0);
    // When: click Log in with phone number instead
    await openPhoneStep(user);
    // Then
    expect((screen.getByLabelText('Country code') as HTMLInputElement).value).toBe('+84');
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Enter your full phone number, like 912 345 678.')).toBeTruthy();
  });

  test('says the number is too short and sends no code', async () => {
    // Given: as above, a spy on the fake's sendCode
    const user = setupUser();
    const { auth } = renderApp('default');
    const sendCode = vi.spyOn(auth, 'sendCode');
    await advance(0);
    await openPhoneStep(user);
    // When: type 12 in Phone number, click Send code
    await user.type(screen.getByLabelText('Phone number'), '12');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await advance(0);
    // Then
    expect(screen.getByText('This number is too short.')).toBeTruthy();
    expect(sendCode).toHaveBeenCalledTimes(0);
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
  });

  test("shows Telegram's no for a number it does not know", async () => {
    // Given: as above
    const user = setupUser();
    renderApp('default');
    await advance(0);
    await openPhoneStep(user);
    // When: type 999999999, click Send code
    await user.type(screen.getByLabelText('Phone number'), '999999999');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await advance(0);
    // Then
    expect(
      screen.getByText('Telegram does not know this number. Check it and try again.'),
    ).toBeTruthy();
  });

  test('sends the code and shows 5 boxes', async () => {
    // Given: as above
    const user = setupUser();
    renderApp('default');
    await advance(0);
    await openPhoneStep(user);
    // When: type 912 345 678, click Send code
    await user.type(screen.getByLabelText('Phone number'), '912 345 678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await advance(0);
    // Then
    expect(screen.getByText('Enter the code sent to your Telegram app')).toBeTruthy();
    expect(screen.getByText('Sent to +84912345678.')).toBeTruthy();
    expect([1, 2, 3, 4, 5].map((n) => digit(n).tagName)).toEqual(Array(5).fill('INPUT'));
    expect(screen.queryByLabelText('Digit 6')).toBeNull();
  });

  test('moves to the next box after each digit', async () => {
    // Given: on the code step
    const user = setupUser();
    await toCodeStep(user);
    // When: type 1, then 2
    await user.keyboard('1');
    await user.keyboard('2');
    // Then
    expect(digit(1).value).toBe('1');
    expect(digit(2).value).toBe('2');
    expect(document.activeElement).toBe(digit(3));
  });

  test('says the code is wrong', async () => {
    // Given: on the code step
    const user = setupUser();
    await toCodeStep(user);
    // When: type 22222
    await user.keyboard('22222');
    await advance(0);
    // Then
    expect(
      screen.getByText(
        'That code is wrong. Check the newest message from Telegram and try again.',
      ),
    ).toBeTruthy();
    expect([1, 2, 3, 4, 5].map((n) => digit(n).value)).toEqual(['', '', '', '', '']);
    expect(document.activeElement).toBe(digit(1));
  });

  test('says the code expired', async () => {
    // Given: on the code step
    const user = setupUser();
    await toCodeStep(user);
    // When: type 00000
    await user.keyboard('00000');
    await advance(0);
    // Then
    expect(screen.getByText('That code expired.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeTruthy();
  });

  test('logs in with the right code', async () => {
    // Given: on the code step for 912 345 678
    const user = setupUser();
    await toCodeStep(user);
    // When: type 12345
    await user.keyboard('12345');
    await advance(0);
    // Then
    const card = within(screen.getByRole('region', { name: 'Log in to Telegram' }));
    expect(card.getByText('Done')).toBeTruthy();
    expect(card.getByText('Minh Anh')).toBeTruthy();
  });

  test('shows Logging in and sends the code once', async () => {
    // Given: fake scenario slow (every answer after 5 s), on the code step, a spy on the fake's submitCode
    const user = setupUser();
    const { auth } = await toCodeStep(user, { scenario: 'slow' });
    const submitCode = vi.spyOn(auth, 'submitCode');
    // When: type 12345, click Log in, click Log in
    await user.keyboard('12345');
    await user.click(screen.getByRole('button', { name: 'Logging in…' }));
    await user.click(screen.getByRole('button', { name: 'Logging in…' }));
    // Then
    const button = screen.getByRole('button', { name: 'Logging in…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(submitCode).toHaveBeenCalledTimes(1);
  });

  test('Change number goes back to the phone field', async () => {
    // Given: on the code step
    const user = setupUser();
    await toCodeStep(user);
    // When: click Change number
    await user.click(screen.getByRole('button', { name: 'Change number' }));
    // Then
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe(
      '912 345 678',
    );
  });

  test('Use QR code instead goes back to the QR', async () => {
    // Given: on the code step
    const user = setupUser();
    await toCodeStep(user);
    // When: click Use QR code instead
    await user.click(screen.getByRole('button', { name: 'Use QR code instead' }));
    await advance(0);
    // Then
    expect(fullText('Point your phone at this code.')).toBeTruthy();
    expect(qrBox().querySelector('svg')).toBeTruthy();
  });
});
