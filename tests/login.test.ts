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
