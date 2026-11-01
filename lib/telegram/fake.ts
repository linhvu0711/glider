import { storage } from 'wxt/utils/storage';
import { AuthError, type Account, type QrCode, type TelegramAuth } from './auth';
import type { Chat, ChatId, ChatKind, TelegramChats } from './chats';

export type FakeScenario =
  | 'default'
  | 'slow'
  | 'qr-scan'
  | 'qr-password'
  | 'qr-expire'
  | 'offline'
  | 'revoked'
  | 'chats-slow'
  | 'chats-error';

export const FAKE_SCENARIOS: FakeScenario[] = [
  'default',
  'slow',
  'qr-scan',
  'qr-password',
  'qr-expire',
  'offline',
  'revoked',
  'chats-slow',
  'chats-error',
];

export function isFakeScenario(value: string | undefined): value is FakeScenario {
  return FAKE_SCENARIOS.includes(value as FakeScenario);
}

export type FakeAuth = TelegramAuth & { setScenario(scenario: FakeScenario): void };

// Pure, so the real build drops it with the rest of the fake.
export const fakeSession = /* @__PURE__ */ storage.defineItem<Account | null>('local:fakeSession', {
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
  // One scan per fake, like one phone: a QR login after a log out waits like a real one.
  let scanned = false;

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
      if (scenario === 'offline') await respond();
      if (scenario === 'revoked' && restores === 1) throw new AuthError('session-ended');
      return fakeSession.getValue();
    },
    loginQr(onCode: (code: QrCode) => void, signal: AbortSignal) {
      return new Promise<Account | 'password'>((resolve, reject) => {
        const life = scenario === 'qr-expire' ? QR_EXPIRE_LIFE_MS : QR_LIFE_MS;
        let timer: ReturnType<typeof setTimeout>;
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
        if (scenario === 'offline') {
          timer = setTimeout(() => reject(new AuthError('offline')), OFFLINE_MS);
        } else {
          timer = setTimeout(emit, scenario === 'slow' ? SLOW_MS : 0);
        }
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

function chat(
  id: number,
  kind: ChatKind,
  name: string,
  username: string | null,
  detail: string,
  initials: string,
  hasPhoto = false,
): Chat {
  return { id: id as ChatId, kind, name, username, detail, initials, hasPhoto };
}

export const FAKE_CHATS: Chat[] = [
  chat(7000, 'self', 'Saved Messages', null, 'Your own chat', ''),
  chat(7001, 'bot', 'Read Later Bot', 'readlater_bot', '@readlater_bot', 'RL'),
  chat(7005, 'person', 'Tuan Vu', null, 'online', 'TV', true),
  chat(7002, 'person', 'Minh Anh', null, 'last seen recently', 'MA'),
  chat(-7003, 'group', 'Design Crew', null, '12 members', 'DC'),
  chat(7004, 'bot', 'Hermes', 'hermes_notes_bot', '@hermes_notes_bot', 'H'),
  chat(-1000000007006, 'channel', 'Glider News', 'glider_news', '1,204 subscribers', 'GN'),
];

export const FAKE_PHOTO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">' +
      '<rect width="160" height="160" fill="#b45309"/>' +
      '<circle cx="80" cy="80" r="40" fill="#fff"/></svg>',
  );

const CHATS_SLOW_MS = 5_000;

// `chats-slow` and `chats-error` log in by phone like `default`; only the chat list differs.
export function createFakeChats({ scenario }: { scenario: FakeScenario }): TelegramChats {
  let lists = 0;
  return {
    async list() {
      lists += 1;
      if (scenario === 'chats-slow') await wait(CHATS_SLOW_MS);
      if (scenario === 'chats-error' && lists === 1) {
        await wait(OFFLINE_MS);
        throw new Error('offline');
      }
      return FAKE_CHATS;
    },
    async photo(id) {
      return id === 7005 ? FAKE_PHOTO : null;
    },
  };
}
