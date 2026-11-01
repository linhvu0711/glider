import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { storage } from 'wxt/utils/storage';
import App from '../entrypoints/options/App';
import { connectInMemory } from '../lib/login/connection';
import { createHost } from '../lib/login/host';
import { createLoginService } from '../lib/login/service';
import type { LoginView } from '../lib/login/state';
import {
  createFakeAuth,
  createFakeChats,
  FAKE_CHATS,
  FAKE_PHOTO,
  LINH,
  MINH,
  type FakeScenario,
} from '../lib/telegram/fake';

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

async function toPasswordStep(user: User) {
  const ctx = renderApp('qr-password');
  await advance(4_000);
  return { ...ctx, user };
}

function passwordInput() {
  return screen.getByLabelText('2-step password') as HTMLInputElement;
}

const PASSWORD_PROMPT = 'Your account has a 2-step password. Enter it to finish.';

describe('2-step password', () => {
  test('asks for the 2-step password after a QR scan', async () => {
    // Given: fake scenario qr-password
    // When: render, advance 4 s
    renderApp('qr-password');
    await advance(4_000);
    // Then
    expect(screen.getByText(PASSWORD_PROMPT)).toBeTruthy();
  });

  test('asks for the 2-step password after the code', async () => {
    // Given: fake scenario default, phone 900000002 sent
    const user = setupUser();
    await toCodeStep(user, { number: '900000002' });
    // When: type 12345
    await user.keyboard('12345');
    await advance(0);
    // Then
    expect(screen.getByText(PASSWORD_PROMPT)).toBeTruthy();
  });

  test('shows and hides the password', async () => {
    // Given: on the password step, glider typed
    const user = setupUser();
    await toPasswordStep(user);
    await user.type(passwordInput(), 'glider');
    // When: click Show password; then click Hide password
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    const shown = passwordInput().type;
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    // Then
    expect(shown).toBe('text');
    expect(passwordInput().type).toBe('password');
  });

  test('says the password is wrong', async () => {
    // Given: on the password step
    const user = setupUser();
    await toPasswordStep(user);
    // When: type nope, click Log in
    await user.type(passwordInput(), 'nope');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await advance(0);
    // Then
    expect(screen.getByText('That password is wrong. Try again.')).toBeTruthy();
    expect(passwordInput().value).toBe('');
  });

  test('logs in with the right password', async () => {
    // Given: on the password step after qr-password
    const user = setupUser();
    await toPasswordStep(user);
    // When: type glider-pass, click Log in
    await user.type(passwordInput(), 'glider-pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await advance(0);
    // Then
    const card = within(screen.getByRole('region', { name: 'Log in to Telegram' }));
    expect(card.getByText('Done')).toBeTruthy();
    expect(card.getByText('Tuan Vu')).toBeTruthy();
  });

  test('shows Logging in and sends the password once', async () => {
    // Given: fake scenario slow with phone 900000002, on the password step, a spy on the fake's submitPassword
    const user = setupUser();
    const { auth } = await toCodeStep(user, { scenario: 'slow', number: '900000002' });
    await user.keyboard('12345');
    await advance(5_000);
    const submitPassword = vi.spyOn(auth, 'submitPassword');
    // When: type glider-pass, click Log in twice
    await user.type(passwordInput(), 'glider-pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.click(screen.getByRole('button', { name: 'Logging in…' }));
    // Then
    const button = screen.getByRole('button', { name: 'Logging in…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(submitPassword).toHaveBeenCalledTimes(1);
  });
});

describe('saved session', () => {
  test('shows the account row when a saved session is still good', async () => {
    // Given: fake saved session Minh Anh, scenario default
    await storage.setItem('local:fakeSession', MINH);
    // When: render a new <App> with a new service and a new fake
    const { auth } = renderApp('default');
    const sendCode = vi.spyOn(auth, 'sendCode');
    const loginQr = vi.spyOn(auth, 'loginQr');
    await advance(0);
    // Then
    const card = within(screen.getByRole('region', { name: 'Log in to Telegram' }));
    expect(card.getByText('Done')).toBeTruthy();
    expect(card.getByText('Minh Anh')).toBeTruthy();
    expect(document.querySelector('svg[data-value]')).toBeNull();
    expect(sendCode).toHaveBeenCalledTimes(0);
    expect(loginQr).toHaveBeenCalledTimes(0);
  });

  test('shows the banner when the saved session ended', async () => {
    // Given: fake scenario revoked
    // When: render, let the first code arrive
    renderApp('revoked');
    await advance(0);
    // Then
    expect(screen.getByText('You were logged out.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log in again' })).toBeTruthy();
    expect(fullText('Point your phone at this code.')).toBeTruthy();
  });

  test('keeps the banner until the next login', async () => {
    // Given: as above, then the page unmounted and a new <App> rendered with the same storage and scenario default
    renderApp('revoked');
    await advance(0);
    cleanup();
    // When: render
    renderApp('default');
    await advance(0);
    // Then
    expect(screen.getByText('You were logged out.')).toBeTruthy();
  });

  test('Log in again hides the banner and shows a new code', async () => {
    // Given: as above
    const user = setupUser();
    renderApp('revoked');
    await advance(0);
    // When: click Log in again
    await user.click(screen.getByRole('button', { name: 'Log in again' }));
    await advance(0);
    // Then
    expect(screen.queryByText('You were logged out.')).toBeNull();
    expect(qrBox().querySelector('svg')?.getAttribute('data-value')).toBe(
      'tg://login?token=fake-2',
    );
    expect(await storage.getItem('local:loggedOutNotice')).toBe(false);
  });

  test('restores the same state twice', async () => {
    // Given: fake saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    const service = createLoginService(createFakeAuth({ scenario: 'default' }), 'Chromium on Linux');
    const connection = connectInMemory(service);
    const views: LoginView[] = [];
    connection.subscribe((view) => views.push(view));
    // When: send hello twice through the connection
    connection.send({ type: 'hello' });
    connection.send({ type: 'hello' });
    await advance(0);
    // Then
    const accounts = views.flatMap((v) => (v.login.step === 'done' ? [v.login.account.name] : []));
    expect(accounts).toEqual(['Minh Anh']);
    expect(await storage.getItem('local:loggedOutNotice')).toBe(false);
    expect(await storage.getItem('local:fakeSession')).toEqual(MINH);
  });
});

describe('log out', () => {
  async function loggedInAsLinh(user: User) {
    const ctx = renderApp('qr-scan');
    await advance(4_000);
    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Log out' }),
    );
    return ctx;
  }

  function dialog() {
    return within(screen.getByRole('dialog'));
  }

  test('opens the log out dialog', async () => {
    // Given: logged in as Linh Vu with qr-scan
    const user = setupUser();
    // When: click Log out in the footer
    await loggedInAsLinh(user);
    // Then
    expect(dialog().getByRole('heading', { name: 'Log out of Glider?' })).toBeTruthy();
    expect(
      dialog().getByText(
        "This also ends Glider's session in Telegram. Links that wait to send are not sent. You can log in again any time.",
      ),
    ).toBeTruthy();
    expect(dialog().getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(dialog().getByRole('button', { name: 'Log out' })).toBeTruthy();
  });

  test('Cancel closes the dialog and stays logged in', async () => {
    // Given: the dialog open
    const user = setupUser();
    const { auth } = await loggedInAsLinh(user);
    const logOut = vi.spyOn(auth, 'logOut');
    // When: click Cancel
    await user.click(dialog().getByRole('button', { name: 'Cancel' }));
    // Then
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('banner')).getByText('Linh Vu')).toBeTruthy();
    expect(logOut).toHaveBeenCalledTimes(0);
  });

  test('Esc closes the dialog', async () => {
    // Given: the dialog open
    const user = setupUser();
    await loggedInAsLinh(user);
    // When: press Escape
    await user.keyboard('{Escape}');
    // Then
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('banner')).getByText('Linh Vu')).toBeTruthy();
  });

  test('Log out ends the session and shows the QR step', async () => {
    // Given: the dialog open
    const user = setupUser();
    const { auth } = await loggedInAsLinh(user);
    const logOut = vi.spyOn(auth, 'logOut');
    // When: click Log out in the dialog
    await user.click(dialog().getByRole('button', { name: 'Log out' }));
    await advance(0);
    // Then
    expect(logOut).toHaveBeenCalledTimes(1);
    expect(await storage.getItem('local:fakeSession')).toBeNull();
    expect(within(screen.getByRole('banner')).getByText('Not logged in')).toBeTruthy();
    expect(fullText('Point your phone at this code.')).toBeTruthy();
  });

  test('stays logged out after log out', async () => {
    // Given: logged in as Linh Vu with qr-scan, the dialog open
    const user = setupUser();
    await loggedInAsLinh(user);
    // When: click Log out in the dialog, then wait past the fake's scan delay
    await user.click(dialog().getByRole('button', { name: 'Log out' }));
    await advance(5_000);
    // Then
    expect(within(screen.getByRole('banner')).getByText('Not logged in')).toBeTruthy();
  });

  test('keeps the dialog open when Telegram cannot be reached', async () => {
    // Given: logged in, then the fake set to offline, the dialog open
    const user = setupUser();
    const { auth } = await loggedInAsLinh(user);
    auth.setScenario('offline');
    // When: click Log out in the dialog
    await user.click(dialog().getByRole('button', { name: 'Log out' }));
    await advance(1_000);
    // Then
    expect(dialog().getByText("Telegram can't be reached. Try again.")).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('Linh Vu')).toBeTruthy();
  });
});

describe('no internet', () => {
  const OFFLINE_TEXT = "Telegram can't be reached. Check your internet connection.";

  test('says Telegram cannot be reached when the first code does not come', async () => {
    // Given: fake scenario offline
    // When: render, advance 2 s
    renderApp('offline');
    await advance(2_000);
    // Then
    expect(screen.getByText(OFFLINE_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  test('says Telegram cannot be reached when the session check times out', async () => {
    // Given: fake saved session Minh Anh, scenario offline
    await storage.setItem('local:fakeSession', MINH);
    // When: render, advance 2 s
    renderApp('offline');
    await advance(2_000);
    // Then
    expect(screen.getByText(OFFLINE_TEXT)).toBeTruthy();
  });

  test('Try again starts over', async () => {
    // Given: on the offline step, then the fake set to default
    const user = setupUser();
    const { auth } = renderApp('offline');
    await advance(2_000);
    auth.setScenario('default');
    // When: click Try again, let the first code arrive
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);
    // Then
    expect(fullText('Point your phone at this code.')).toBeTruthy();
    expect(qrBox().querySelector('svg')).toBeTruthy();
  });
});

describe('QR expiry', () => {
  test('shows This code expired after 5 codes', async () => {
    // Given: fake scenario qr-expire, fake timers
    // When: render, advance 11 s
    renderApp('qr-expire');
    await advance(11_000);
    // Then
    expect(screen.getByText('This code expired.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get a new code' })).toBeTruthy();
    expect(document.querySelector('svg[data-value]')).toBeNull();
    expect(screen.queryByText(/^New code in/)).toBeNull();
  });

  test('Get a new code shows a fresh code', async () => {
    // Given: as above
    const user = setupUser();
    renderApp('qr-expire');
    await advance(11_000);
    // When: click Get a new code, advance 0 s for the first code
    await user.click(screen.getByRole('button', { name: 'Get a new code' }));
    await advance(0);
    // Then
    expect(qrBox().querySelector('svg')).toBeTruthy();
    expect(screen.getByText('New code in 0:02')).toBeTruthy();
  });
});

describe('two tabs', () => {
  test('a second tab keeps the phone step of the first tab', async () => {
    // Given: tab 1 on the phone step
    const service = createLoginService(createFakeAuth({ scenario: 'default' }), 'Chromium on Linux');
    const tab1 = connectInMemory(service);
    const views: LoginView[] = [];
    tab1.subscribe((view) => views.push(view));
    tab1.send({ type: 'hello' });
    await advance(0);
    tab1.send({ type: 'usePhone' });
    // When: tab 2 opens and says hello
    const tab2 = connectInMemory(service);
    tab2.subscribe(() => {});
    tab2.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(views.at(-1)?.login.step).toBe('phone');
  });

  test('a tab that opens late gets the same QR code at once', async () => {
    // Given: tab 1 shows the first QR code
    const host = createHost(
      async () => createLoginService(createFakeAuth({ scenario: 'default' }), 'Chromium on Linux'),
      { fake: false },
    );
    host.subscribe(() => {});
    host.send({ type: 'hello' });
    await advance(0);
    // When: tab 2 connects and says hello
    const views: LoginView[] = [];
    host.subscribe((view) => views.push(view));
    host.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(views.map((v) => (v.login.step === 'qr' ? v.login.code?.url : v.login.step))).toEqual([
      'tg://login?token=fake-1',
    ]);
  });

  test('a tab that opens after every tab closed gets a new QR code', async () => {
    // Given: one tab saw the first QR code, then every tab closed
    const host = createHost(
      async () => createLoginService(createFakeAuth({ scenario: 'default' }), 'Chromium on Linux'),
      { fake: false },
    );
    const unsubscribe = host.subscribe(() => {});
    host.send({ type: 'hello' });
    await advance(0);
    unsubscribe();
    host.stop();
    await advance(0);
    // When: a new tab connects and says hello
    const views: LoginView[] = [];
    host.subscribe((view) => views.push(view));
    host.send({ type: 'hello' });
    await advance(0);
    // Then
    const last = views.at(-1)?.login;
    expect(last?.step === 'qr' ? last.code?.url : last?.step).toBe('tg://login?token=fake-2');
  });
});

function renderSettings(scenario: FakeScenario, options?: { container?: HTMLElement }) {
  const service = createLoginService(createFakeAuth({ scenario }), 'Chromium on Linux');
  return render(
    <App connection={connectInMemory(service)} chats={createFakeChats({ scenario })} />,
    options?.container ? { container: options.container } : undefined,
  );
}

function stepTwo() {
  return screen.getByRole('region', { name: 'Choose the chat' });
}

function rowOf(name: string) {
  return screen.getByRole('radio', { name }).closest('label') as HTMLElement;
}

describe('choose the chat', () => {
  test('greys out step 2 when not logged in', async () => {
    // Given: fake scenario default, no saved session
    // When
    renderSettings('default');
    await advance(0);
    // Then
    expect(
      stepTwo().getAttribute('aria-disabled') === 'true' &&
        screen.queryByLabelText('Search your chats') === null,
    ).toBe(true);
  });

  test('shows the line, the search box, and Recent chats when logged in', async () => {
    // Given: saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    // When
    renderSettings('default');
    await advance(0);
    // Then
    const card = within(stepTwo());
    expect([
      !!card.getByText(
        'Links go to this one chat, sent by you. You can change it any time.',
      ),
      !!card.getByRole('searchbox', { name: 'Search your chats' }),
      within(card.getByRole('radiogroup', { name: 'Recent chats' })).getAllByRole('radio').length,
    ]).toEqual([true, true, 7]);
  });

  test('shows each chat with its second line and tag', async () => {
    // Given: saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    // When
    renderSettings('default');
    await advance(0);
    // Then
    const rows = screen
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent);
    expect(rows).toEqual([
      'Saved MessagesYour own chatYou',
      'RLRead Later Bot@readlater_botBot',
      'Tuan VuonlinePerson',
      'MAMinh Anhlast seen recentlyPerson',
      'DCDesign Crew12 membersGroup',
      'HHermes@hermes_notes_botBot',
      'GNGlider News1,204 subscribersChannel',
    ]);
  });

  test('shows Saved Messages as Your own chat', async () => {
    // Given: saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    // When
    renderSettings('default');
    await advance(0);
    // Then
    const row = rowOf('Saved Messages');
    expect([!!row.querySelector('.avatar svg'), row.querySelector('img')]).toEqual([true, null]);
  });

  test('shows the chat photo when the chat has one', async () => {
    // Given: saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    // When
    renderSettings('default');
    await advance(0);
    // Then
    expect(rowOf('Tuan Vu').querySelector('img')?.getAttribute('src')).toBe(FAKE_PHOTO);
  });
});

describe('choose the chat: loading and errors', () => {
  test('shows grey rows while chats load', async () => {
    // Given: saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    // When: chats take 5 s, advance 1 s
    renderSettings('chats-slow');
    await advance(1_000);
    // Then
    expect(screen.getAllByTestId('chat-placeholder')).toHaveLength(5);
  });

  test('says the chats could not load', async () => {
    // Given: saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    // When: log in, then the first load fails after 1 s
    renderSettings('chats-error');
    await advance(0);
    await advance(1_000);
    // Then
    const card = within(stepTwo());
    expect([
      !!card.getByText('Could not load your chats. Check your internet.'),
      !!card.getByRole('button', { name: 'Try again' }),
    ]).toEqual([true, true]);
  });

  test('Try again loads the chats', async () => {
    // Given: saved session Minh Anh, the first load failed
    await storage.setItem('local:fakeSession', MINH);
    const user = setupUser();
    renderSettings('chats-error');
    await advance(0);
    await advance(1_000);
    // When
    await user.click(within(stepTwo()).getByRole('button', { name: 'Try again' }));
    await advance(0);
    // Then
    expect(
      within(screen.getByRole('radiogroup', { name: 'Recent chats' })).getAllByRole('radio'),
    ).toHaveLength(7);
  });
});

describe('choose the chat: search', () => {
  async function loggedInSearch() {
    await storage.setItem('local:fakeSession', MINH);
    const user = setupUser();
    renderSettings('default');
    await advance(0);
    return user;
  }

  test('filters chats by name under Results', async () => {
    // Given: saved session Minh Anh, the chat list loaded
    const user = await loggedInSearch();
    // When
    await user.type(screen.getByLabelText('Search your chats'), 'herm');
    // Then
    const results = screen.getByRole('radiogroup', { name: 'Results' });
    expect(within(results).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Hermes',
    ]);
  });

  test('filters chats by @username', async () => {
    // Given: as above
    const user = await loggedInSearch();
    // When
    await user.type(screen.getByLabelText('Search your chats'), '@glider');
    // Then
    const results = screen.getByRole('radiogroup', { name: 'Results' });
    expect(within(results).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Glider News',
    ]);
  });

  test('says no chat has that name', async () => {
    // Given: as above
    const user = await loggedInSearch();
    // When
    await user.type(screen.getByLabelText('Search your chats'), 'zzz');
    // Then
    expect(
      screen.getByText(
        'No chat named "zzz". Check the spelling, or open the chat in Telegram once so it shows here.',
      ),
    ).toBeTruthy();
  });
});

describe('choose the chat: save', () => {
  const READ_LATER = FAKE_CHATS.find((chat) => chat.name === 'Read Later Bot');
  const HERMES = FAKE_CHATS.find((chat) => chat.name === 'Hermes');

  async function loggedIn() {
    await storage.setItem('local:fakeSession', MINH);
    const user = setupUser();
    renderSettings('default');
    await advance(0);
    return user;
  }

  test('picking another chat turns on Save and names it', async () => {
    // Given: saved session Minh Anh, nothing saved in local:targetChat
    const user = await loggedIn();
    // When
    await user.click(screen.getByRole('radio', { name: 'Read Later Bot' }));
    // Then
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect([save.disabled, !!screen.getByText('Links will go to Read Later Bot.')]).toEqual([
      false,
      true,
    ]);
  });

  test('Save shows the toast and the Done chip', async () => {
    // Given: Read Later Bot picked
    const user = await loggedIn();
    await user.click(screen.getByRole('radio', { name: 'Read Later Bot' }));
    // When
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await advance(0);
    // Then
    expect([
      screen.getByRole('status').textContent,
      !!within(stepTwo()).getByText('Done'),
      await storage.getItem('local:targetChat'),
    ]).toEqual([
      'Saved. Links now go to Read Later Bot.',
      true,
      { account: MINH.id, chat: READ_LATER },
    ]);
  });

  test('shows the saved chat first with the tag Current', async () => {
    // Given: Hermes saved
    await storage.setItem('local:targetChat', { account: MINH.id, chat: HERMES });
    // When
    await loggedIn();
    // Then
    const first = screen.getAllByRole('radio')[0] as HTMLInputElement;
    expect([
      first.getAttribute('aria-label'),
      first.checked,
      first.closest('label')?.textContent?.endsWith('Current'),
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
      !!screen.getByText('Links go to Hermes.'),
    ]).toEqual(['Hermes', true, true, true, true]);
  });

  test('keeps the saved chat after a restart', async () => {
    // Given: Read Later Bot saved, then the page closed
    const user = await loggedIn();
    await user.click(screen.getByRole('radio', { name: 'Read Later Bot' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await advance(0);
    cleanup();
    // When: a new page with a new service and a new fake
    renderSettings('default');
    await advance(0);
    // Then
    const first = screen.getAllByRole('radio')[0] as HTMLInputElement;
    expect([
      first.getAttribute('aria-label'),
      first.checked,
      !!within(stepTwo()).getByText('Done'),
    ]).toEqual(['Read Later Bot', true, true]);
  });

  test('two tabs that save the same chat keep one saved chat', async () => {
    // Given: saved session Minh Anh, two pages
    await storage.setItem('local:fakeSession', MINH);
    const user = setupUser();
    const tabs = [document.createElement('div'), document.createElement('div')];
    for (const tab of tabs) {
      document.body.appendChild(tab);
      renderSettings('default', { container: tab });
    }
    await advance(0);
    // When: each page picks Read Later Bot and saves
    for (const tab of tabs) {
      await user.click(within(tab).getByRole('radio', { name: 'Read Later Bot' }));
      const save = within(tab).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      if (!save.disabled) await user.click(save);
      await advance(0);
    }
    // Then
    expect(await storage.getItem('local:targetChat')).toEqual({ account: MINH.id, chat: READ_LATER });
  });
  test('another account starts with no saved chat', async () => {
    // Given: Hermes saved by Linh Vu
    await storage.setItem('local:targetChat', { account: LINH.id, chat: HERMES });
    // When: Minh Anh is logged in
    await loggedIn();
    // Then
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect([
      radios[0]?.getAttribute('aria-label'),
      radios.some((radio) => radio.checked),
      screen.queryByText('Current'),
      within(stepTwo()).queryByText('Done'),
    ]).toEqual(['Saved Messages', false, null, null]);
  });

  test('log out clears the list, the pick, and the search', async () => {
    // Given: Minh Anh logged in, chats take 5 s, Hermes found and picked
    await storage.setItem('local:fakeSession', MINH);
    const user = setupUser();
    renderSettings('chats-slow');
    await advance(0);
    await advance(5_000);
    await user.type(screen.getByRole('searchbox', { name: 'Search your chats' }), 'herm');
    await user.click(screen.getByRole('radio', { name: 'Hermes' }));
    // When: log out, then log in again by phone
    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Log out' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out' }),
    );
    await advance(0);
    await openPhoneStep(user);
    await user.type(screen.getByLabelText('Phone number'), '912 345 678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await advance(0);
    await user.keyboard('12345');
    await advance(0);
    // Then: grey rows while the list loads, then nothing picked and no search
    const loading = [
      screen.getAllByTestId('chat-placeholder').length,
      screen.queryAllByRole('radio').length,
    ];
    await advance(5_000);
    expect([
      ...loading,
      (screen.getByRole('searchbox', { name: 'Search your chats' }) as HTMLInputElement).value,
      (screen.getAllByRole('radio') as HTMLInputElement[]).some((radio) => radio.checked),
    ]).toEqual([5, 0, '', false]);
  });
  test('another settings tab keeps the pick and the search', async () => {
    // Given: Minh Anh logged in, Hermes found and picked, not saved
    await storage.setItem('local:fakeSession', MINH);
    const user = setupUser();
    const auth = createFakeAuth({ scenario: 'default' });
    const service = createLoginService(auth, 'Chromium on Linux');
    const chats = createFakeChats({ scenario: 'default' });
    const firstTab = document.body.appendChild(document.createElement('div'));
    const secondTab = document.body.appendChild(document.createElement('div'));
    render(<App connection={connectInMemory(service)} chats={chats} />, { container: firstTab });
    await advance(0);
    const first = within(firstTab);
    await user.type(first.getByRole('searchbox', { name: 'Search your chats' }), 'herm');
    await user.click(first.getByRole('radio', { name: 'Hermes' }));
    // When: a second settings tab opens, and the session check takes 1 s
    const restore = auth.restore.bind(auth);
    vi.spyOn(auth, 'restore').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return restore();
    });
    render(<App connection={connectInMemory(service)} chats={chats} />, { container: secondTab });
    await advance(0);
    await advance(1_000);
    // Then
    expect([
      (first.getByRole('searchbox', { name: 'Search your chats' }) as HTMLInputElement).value,
      (first.getByRole('radio', { name: 'Hermes' }) as HTMLInputElement).checked,
    ]).toEqual(['herm', true]);
  });
});
