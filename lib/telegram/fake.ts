import { storage } from 'wxt/utils/storage';
import { AuthError, type Account, type QrCode, type TelegramAuth } from './auth';
import type { Chat, ChatId, ChatKind, TelegramChats } from './chats';
import { SendError, type SendFailure, type TelegramSend } from './send';

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

// How the next account checks answer, one entry each, so a walk can make the check fail.
const fakeAccountChecks = /* @__PURE__ */ storage.defineItem<('ok' | 'throws' | 'hangs')[]>(
  'local:fakeAccountChecks',
  { fallback: [] },
);

const QR_LIFE_MS = 30_000;
const QR_EXPIRE_LIFE_MS = 2_000;
const SLOW_MS = 5_000;
const OFFLINE_MS = 1_000;
const SCAN_AFTER_MS = 3_000;

export const LINH: Account = { id: 7100, name: 'Linh Vu', initials: 'LV' };
export const MINH: Account = { id: 7101, name: 'Minh Anh', initials: 'MA' };
const TUAN: Account = { id: 7102, name: 'Tuan Vu', initials: 'TV' };
const PASSWORD = 'glider-pass';

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createFakeAuth(options: { scenario: FakeScenario }): FakeAuth {
  let scenario = options.scenario;
  let tokenCount = 0;
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
      return { phone: number, length: 5, hash: 'fake-hash' };
    },
    async submitCode(sent, code) {
      await respond();
      if (code === '00000') throw new AuthError('code-expired');
      if (code !== '12345') throw new AuthError('bad-code');
      return sent.phone === '84900000002' ? 'password' : logIn(MINH);
    },
    async submitPassword(password) {
      await respond();
      if (password !== PASSWORD) throw new AuthError('bad-password');
      return logIn(TUAN);
    },
    async logOut() {
      await respond();
      if (scenario === 'revoked') throw new AuthError('session-ended');
      await fakeSession.setValue(null);
    },
    forget: () => fakeSession.setValue(null),
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

export type FakeChats = TelegramChats & { setScenario(scenario: FakeScenario): void };

// `chats-slow` and `chats-error` log in by phone like `default`; only the chat list differs.
export function createFakeChats(options: { scenario: FakeScenario }): FakeChats {
  let scenario = options.scenario;
  let lists = 0;
  return {
    setScenario(next) {
      scenario = next;
      lists = 0;
    },
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

export type FakeSend = TelegramSend & { sent: { chat: ChatId; text: string }[] };

// A page whose address ends `#fail=<reason>` fails its first send, so tests and the
// fake build can show each failure; `wait-<n>` asks to wait n seconds.
function fakeFailure(text: string): SendFailure | null {
  const match = /#fail=([a-z-]+?)(?:-(\d+))?$/.exec(text);
  if (!match) return null;
  const [, reason, seconds] = match;
  if (reason === 'wait' && seconds) return { reason: 'wait', seconds: Number(seconds) };
  if (reason === 'offline' || reason === 'logged-out' || reason === 'unreachable' || reason === 'other') {
    return { reason };
  }
  return null;
}

// The fake build's sends go nowhere; `sent` lets a test see them.
export function createFakeSend(): FakeSend {
  const sent: { chat: ChatId; text: string }[] = [];
  const failed = new Set<string>();
  return {
    sent,
    async account() {
      const [next, ...rest] = await fakeAccountChecks.getValue();
      if (next) {
        await fakeAccountChecks.setValue(rest);
        if (next === 'throws') throw new Error('The fake account check failed.');
        if (next === 'hangs') return new Promise<never>(() => {});
      }
      return (await fakeSession.getValue())?.id ?? null;
    },
    async sendText(chat, text) {
      const failure = failed.has(text) ? null : fakeFailure(text);
      if (failure) {
        failed.add(text);
        throw new SendError(failure);
      }
      sent.push({ chat, text });
    },
  };
}
