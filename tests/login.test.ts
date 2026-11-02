import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { storage } from 'wxt/utils/storage';
import { createLoginService } from '../lib/login/service';
import type { LoginView } from '../lib/login/state';
import { createFakeAuth, MINH, type FakeScenario } from '../lib/telegram/fake';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-31T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

function start(scenario: FakeScenario) {
  const auth = createFakeAuth({ scenario });
  const service = createLoginService(auth, 'Chromium on Linux');
  const views: LoginView[] = [];
  service.subscribe((view) => views.push(view));
  return { auth, service, views };
}

function lastLogin(views: LoginView[]) {
  return views.at(-1)?.login;
}

function qrUrl(views: LoginView[]) {
  const login = lastLogin(views);
  return login?.step === 'qr' ? login.code?.url : login?.step;
}

describe('session check', () => {
  test('shows the saved account after a hello', async () => {
    // Given: fake saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('default');
    // When
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'done',
      account: { id: 7101, name: 'Minh Anh', initials: 'MA' },
      device: 'Chromium on Linux',
      logout: 'idle',
    });
  });

  test('shows a QR code when no session is saved', async () => {
    // Given: no saved session
    const { service, views } = start('default');
    // When
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    const login = lastLogin(views);
    expect(login?.step === 'qr' ? [login.code?.url, login.expired] : login?.step).toEqual([
      'tg://login?token=fake-1',
      false,
    ]);
  });

  test('shows the notice and a new QR code when the session ended', async () => {
    // Given: fake scenario revoked
    const { service, views } = start('revoked');
    // When
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    expect([views.at(-1)?.notice, qrUrl(views), await storage.getItem('local:loggedOutNotice')]).toEqual([
      true,
      'tg://login?token=fake-1',
      true,
    ]);
  });

  test('forgets the saved account when the session ended', async () => {
    // Given: fake saved session Minh Anh, scenario revoked
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('revoked');
    // When
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    expect([views.at(-1)?.notice, qrUrl(views), await storage.getItem('local:fakeSession')]).toEqual([
      true,
      'tg://login?token=fake-1',
      null,
    ]);
  });

  test('says Telegram cannot be reached when the session check fails', async () => {
    // Given: fake saved session Minh Anh, scenario offline
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('offline');
    // When
    service.send({ type: 'hello' });
    await advance(1_000);
    // Then
    expect(lastLogin(views)).toEqual({ step: 'offline' });
  });

  test('restores the same state twice', async () => {
    // Given: fake saved session Minh Anh
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('default');
    // When: send hello twice
    service.send({ type: 'hello' });
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    const accounts = views.flatMap((v) => (v.login.step === 'done' ? [v.login.account.name] : []));
    expect(accounts).toEqual(['Minh Anh']);
    expect(await storage.getItem('local:loggedOutNotice')).toBe(false);
    expect(await storage.getItem('local:fakeSession')).toEqual(MINH);
  });

  test('a second tab keeps the phone step of the first tab', async () => {
    // Given: tab 1 on the phone step
    const { service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    service.send({ type: 'usePhone' });
    // When: tab 2 opens and says hello
    service.subscribe(() => {});
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(lastLogin(views)?.step).toBe('phone');
  });
});

describe('QR code', () => {
  test('says the QR code expired after 5 codes', async () => {
    // Given: each code lives 2 s
    const { service, views } = start('qr-expire');
    // When
    service.send({ type: 'hello' });
    await advance(10_000);
    // Then
    expect(lastLogin(views)).toEqual({ step: 'qr', code: null, expired: true });
  });

  test('logs in when the QR code is scanned', async () => {
    // Given: the code is scanned 3 s after it shows
    const { service, views } = start('qr-scan');
    // When
    service.send({ type: 'hello' });
    await advance(3_000);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'done',
      account: { id: 7100, name: 'Linh Vu', initials: 'LV' },
      device: 'Chromium on Linux',
      logout: 'idle',
    });
  });

  test('asks for the 2-step password after a QR scan', async () => {
    // Given: the scanned account has a 2-step password
    const { service, views } = start('qr-password');
    // When
    service.send({ type: 'hello' });
    await advance(3_000);
    // Then
    expect(lastLogin(views)).toEqual({ step: 'password', error: null, busy: false });
  });

  test('a login clears the notice', async () => {
    // Given: the session ended, so the notice shows; the next code gets scanned
    const { auth, service, views } = start('revoked');
    service.send({ type: 'hello' });
    await advance(0);
    auth.setScenario('qr-scan');
    // When
    service.send({ type: 'newQr' });
    await advance(3_000);
    // Then
    const login = lastLogin(views);
    expect([
      views.at(-1)?.notice,
      login?.step === 'done' ? login.account.name : login?.step,
      await storage.getItem('local:loggedOutNotice'),
    ]).toEqual([false, 'Linh Vu', false]);
  });

  test('a hello after stop gets a new QR code', async () => {
    // Given: the first code showed, then every tab closed
    const { service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    service.stop();
    // When
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    expect(qrUrl(views)).toBe('tg://login?token=fake-2');
  });
});

describe('log out', () => {
  test('log out ends the session and shows a new QR code', async () => {
    // Given: Minh Anh logged in
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    // When
    service.send({ type: 'logOut' });
    await advance(0);
    // Then
    expect([qrUrl(views), await storage.getItem('local:fakeSession')]).toEqual([
      'tg://login?token=fake-1',
      null,
    ]);
  });

  test('log out of an ended session forgets the account and shows a new code', async () => {
    // Given: Minh Anh logged in, then Telegram says the session ended
    await storage.setItem('local:fakeSession', MINH);
    const { auth, service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    auth.setScenario('revoked');
    // When
    service.send({ type: 'logOut' });
    await advance(0);
    // Then
    expect([qrUrl(views), await storage.getItem('local:fakeSession'), views.at(-1)?.notice]).toEqual([
      'tg://login?token=fake-1',
      null,
      false,
    ]);
  });

  test('stays logged in and says so when log out cannot reach Telegram', async () => {
    // Given: Minh Anh logged in, then Telegram cannot be reached
    await storage.setItem('local:fakeSession', MINH);
    const { auth, service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    auth.setScenario('offline');
    // When
    service.send({ type: 'logOut' });
    await advance(1_000);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'done',
      account: { id: 7101, name: 'Minh Anh', initials: 'MA' },
      device: 'Chromium on Linux',
      logout: 'offline',
    });
  });

  test('ignores a command while it is busy', async () => {
    // Given: Minh Anh logged in, log out takes 5 s
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('slow');
    service.send({ type: 'hello' });
    await advance(0);
    service.send({ type: 'logOut' });
    // When
    service.send({ type: 'usePhone' });
    await advance(0);
    // Then
    const login = lastLogin(views);
    expect(login?.step === 'done' ? login.logout : login?.step).toBe('busy');
  });
});

describe('logged out notice', () => {
  test('Log in again clears the notice and shows a new code', async () => {
    // Given: the session ended, so the notice and the first code show
    const { service, views } = start('revoked');
    service.send({ type: 'hello' });
    await advance(0);
    // When
    service.send({ type: 'logInAgain' });
    await advance(0);
    // Then
    expect([views.at(-1)?.notice, qrUrl(views), await storage.getItem('local:loggedOutNotice')]).toEqual([
      false,
      'tg://login?token=fake-2',
      false,
    ]);
  });
});

describe('phone login', () => {
  async function onPhoneStep() {
    const started = start('default');
    started.service.send({ type: 'hello' });
    await advance(0);
    started.service.send({ type: 'usePhone' });
    return started;
  }

  async function onCodeStep(number = '912 345 678') {
    const started = await onPhoneStep();
    started.service.send({ type: 'sendCode', country: '+84', number });
    await advance(0);
    return started;
  }

  async function onPasswordStep() {
    const started = await onCodeStep('900000002');
    started.service.send({ type: 'submitCode', code: '12345' });
    await advance(0);
    return started;
  }

  test('asks for the code after a good number', async () => {
    // Given: on the phone step
    const { service, views } = await onPhoneStep();
    // When
    service.send({ type: 'sendCode', country: '+84', number: '912 345 678' });
    await advance(0);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'code',
      phone: '84912345678',
      length: 5,
      error: null,
      busy: false,
    });
  });

  test('says the number is too short and asks Telegram nothing', async () => {
    // Given: on the phone step
    const { auth, service, views } = await onPhoneStep();
    const sendCode = vi.spyOn(auth, 'sendCode');
    // When
    service.send({ type: 'sendCode', country: '+84', number: '12' });
    await advance(0);
    // Then
    expect([lastLogin(views), sendCode.mock.calls.length]).toEqual([
      { step: 'phone', error: 'This number is too short.', busy: false },
      0,
    ]);
  });

  test('says Telegram does not know the number', async () => {
    // Given: on the phone step
    const { service, views } = await onPhoneStep();
    // When
    service.send({ type: 'sendCode', country: '+84', number: '999 999 999' });
    await advance(0);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'phone',
      error: 'Telegram does not know this number. Check it and try again.',
      busy: false,
    });
  });

  test('says the code is wrong', async () => {
    // Given: the code was sent to +84 912 345 678
    const { service, views } = await onCodeStep();
    // When
    service.send({ type: 'submitCode', code: '11111' });
    await advance(0);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'code',
      phone: '84912345678',
      length: 5,
      error: 'wrong',
      busy: false,
    });
  });

  test('says the code expired', async () => {
    // Given: the code was sent to +84 912 345 678
    const { service, views } = await onCodeStep();
    // When
    service.send({ type: 'submitCode', code: '00000' });
    await advance(0);
    // Then
    const login = lastLogin(views);
    expect(login?.step === 'code' ? login.error : login?.step).toBe('expired');
  });

  test('logs in with the right code', async () => {
    // Given: the code was sent to +84 912 345 678
    const { service, views } = await onCodeStep();
    // When
    service.send({ type: 'submitCode', code: '12345' });
    await advance(0);
    // Then
    expect(lastLogin(views)).toEqual({
      step: 'done',
      account: { id: 7101, name: 'Minh Anh', initials: 'MA' },
      device: 'Chromium on Linux',
      logout: 'idle',
    });
  });

  test('says the 2-step password is wrong', async () => {
    // Given: the account of +84 900 000 002 asks for its 2-step password
    const { service, views } = await onPasswordStep();
    // When
    service.send({ type: 'submitPassword', password: 'nope' });
    await advance(0);
    // Then
    expect(lastLogin(views)).toEqual({ step: 'password', error: 'wrong', busy: false });
  });

  test('logs in with the right 2-step password', async () => {
    // Given: the account of +84 900 000 002 asks for its 2-step password
    const { service, views } = await onPasswordStep();
    // When
    service.send({ type: 'submitPassword', password: 'glider-pass' });
    await advance(0);
    // Then
    const login = lastLogin(views);
    expect(login?.step === 'done' ? login.account.name : login?.step).toBe('Tuan Vu');
  });
});

describe('account', () => {
  test('keeps the account through a session re-check', async () => {
    // Given: Minh Anh logged in
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    // When: another tab says hello
    service.send({ type: 'hello' });
    await advance(0);
    // Then
    const checking = views.filter((view) => view.login.step === 'checking').at(-1);
    expect(checking?.account).toEqual({ id: 7101, name: 'Minh Anh', initials: 'MA' });
  });

  test('has no account after log out', async () => {
    // Given: Minh Anh logged in
    await storage.setItem('local:fakeSession', MINH);
    const { service, views } = start('default');
    service.send({ type: 'hello' });
    await advance(0);
    // When
    service.send({ type: 'logOut' });
    await advance(0);
    // Then
    expect(views.at(-1)?.account).toEqual(null);
  });
});
