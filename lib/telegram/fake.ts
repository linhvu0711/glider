import { storage } from 'wxt/utils/storage';
import { AuthError, type Account, type QrCode, type TelegramAuth } from './auth';

export type FakeScenario =
  | 'default'
  | 'slow'
  | 'qr-scan'
  | 'qr-password'
  | 'qr-expire'
  | 'offline'
  | 'revoked';

export const FAKE_SCENARIOS: FakeScenario[] = [
  'default',
  'slow',
  'qr-scan',
  'qr-password',
  'qr-expire',
  'offline',
  'revoked',
];

export function isFakeScenario(value: string | undefined): value is FakeScenario {
  return FAKE_SCENARIOS.includes(value as FakeScenario);
}

export type FakeAuth = TelegramAuth & { setScenario(scenario: FakeScenario): void };

export const fakeSession = storage.defineItem<Account | null>('local:fakeSession', {
  fallback: null,
});

const QR_LIFE_MS = 30_000;
const QR_EXPIRE_LIFE_MS = 2_000;
const SLOW_MS = 5_000;
const OFFLINE_MS = 1_000;
const SCAN_AFTER_MS = 3_000;

const LINH: Account = { name: 'Linh Vu', initials: 'LV' };
const MINH: Account = { name: 'Minh Anh', initials: 'MA' };
const TUAN: Account = { name: 'Tuan Vu', initials: 'TV' };
const PASSWORD = 'glider-pass';

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createFakeAuth(options: { scenario: FakeScenario }): FakeAuth {
  let scenario = options.scenario;
  let tokenCount = 0;
  let phone = '';
  let restores = 0;

  async function respond() {
    if (scenario === 'offline') {
      await wait(OFFLINE_MS);
      throw new AuthError('offline');
    }
    await wait(scenario === 'slow' ? SLOW_MS : 0);
  }

  async function logIn(account: Account) {
    await fakeSession.setValue(account);
    return account;
  }

  return {
    setScenario(next) {
      scenario = next;
    },
    async restore() {
      restores += 1;
      if (scenario === 'revoked' && restores === 1) throw new AuthError('session-ended');
      return fakeSession.getValue();
    },
    loginQr(onCode: (code: QrCode) => void, signal: AbortSignal) {
      return new Promise<Account | 'password'>((resolve, reject) => {
        const life = scenario === 'qr-expire' ? QR_EXPIRE_LIFE_MS : QR_LIFE_MS;
        let timer: ReturnType<typeof setTimeout>;
        let scanned = false;
        const emit = () => {
          tokenCount += 1;
          onCode({
            url: `tg://login?token=fake-${tokenCount}`,
            expires: Date.now() + life,
          });
          timer = setTimeout(emit, life);
          if ((scenario === 'qr-scan' || scenario === 'qr-password') && !scanned) {
            scanned = true;
            setTimeout(() => {
              if (signal.aborted) return;
              clearTimeout(timer);
              if (scenario === 'qr-scan') void logIn(LINH).then(resolve);
              else resolve('password');
            }, SCAN_AFTER_MS);
          }
        };
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new AuthError('offline'));
          },
          { once: true },
        );
        timer = setTimeout(emit, scenario === 'slow' ? SLOW_MS : 0);
      });
    },
    async sendCode(number) {
      await respond();
      if (number === '84999999999') throw new AuthError('bad-phone');
      phone = number;
      return { length: 5 };
    },
    async submitCode(code) {
      await respond();
      if (code === '00000') throw new AuthError('code-expired');
      if (code !== '12345') throw new AuthError('bad-code');
      return phone === '84900000002' ? 'password' : logIn(MINH);
    },
    async submitPassword(password) {
      await respond();
      if (password !== PASSWORD) throw new AuthError('bad-password');
      return logIn(TUAN);
    },
    async logOut() {
      await respond();
      await fakeSession.setValue(null);
    },
  };
}
