import {
  Long,
  MtArgumentError,
  MtPeerNotFoundError,
  Chat as TgChat,
  TelegramClient,
  tl,
  User,
} from '@mtcute/web';
import { deviceName, type Device } from '../device';
import { AuthError, type Account, type TelegramAuth } from './auth';
import type { Chat, ChatId, TelegramChats } from './chats';
import { SendError, type TelegramSend } from './send';

const TIMEOUT_MS = 15_000;
const DATABASE = 'glider';

export function mtcuteClientOptions(
  config: { apiId: number; apiHash: string },
  device: Device,
  version: string,
) {
  return {
    apiId: config.apiId,
    apiHash: config.apiHash,
    storage: DATABASE,
    initConnectionOptions: {
      deviceModel: `Glider · ${deviceName(device)}`,
      appVersion: version,
      systemVersion: device.os ?? 'unknown',
    },
  };
}

const SESSION_ENDED = [
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_DUPLICATED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
];

export function toAuthError(e: unknown): AuthError {
  if (e instanceof AuthError) return e;
  if (tl.RpcError.is(e, 'PHONE_NUMBER_INVALID')) return new AuthError('bad-phone');
  if (tl.RpcError.is(e, 'PHONE_CODE_INVALID') || tl.RpcError.is(e, 'PHONE_CODE_EMPTY')) {
    return new AuthError('bad-code');
  }
  if (tl.RpcError.is(e, 'PHONE_CODE_EXPIRED')) return new AuthError('code-expired');
  if (tl.RpcError.is(e, 'PASSWORD_HASH_INVALID')) return new AuthError('bad-password');
  if (SESSION_ENDED.some((text) => tl.RpcError.is(e, text))) {
    return new AuthError('session-ended');
  }
  return new AuthError('offline');
}

// The chat is gone, blocks the user, or does not let them post.
const CANT_REACH = [
  'PEER_ID_INVALID',
  'CHAT_WRITE_FORBIDDEN',
  'CHAT_SEND_PLAIN_FORBIDDEN',
  'CHAT_RESTRICTED',
  'CHAT_ADMIN_REQUIRED',
  'CHAT_GUEST_SEND_FORBIDDEN',
  'USER_IS_BLOCKED',
  'YOU_BLOCKED_USER',
  'USER_BANNED_IN_CHANNEL',
  'USER_PRIVACY_RESTRICTED',
  'PRIVACY_PREMIUM_REQUIRED',
  'INPUT_USER_DEACTIVATED',
  'CHANNEL_PRIVATE',
  'CHANNEL_INVALID',
  'CHAT_ID_INVALID',
  'USER_ID_INVALID',
];

export function toSendError(e: unknown): SendError {
  if (e instanceof SendError) return e;
  // mtcute sleeps through waits of up to 10 s itself; longer ones reach here.
  if (
    tl.RpcError.is(e, 'FLOOD_WAIT_%d') ||
    tl.RpcError.is(e, 'SLOWMODE_WAIT_%d') ||
    tl.RpcError.is(e, 'FLOOD_PREMIUM_WAIT_%d')
  ) {
    return new SendError({ reason: 'wait', seconds: e.seconds });
  }
  // start() throws MtArgumentError when the saved session has ended.
  if (e instanceof MtArgumentError || SESSION_ENDED.some((text) => tl.RpcError.is(e, text))) {
    return new SendError({ reason: 'logged-out' });
  }
  if (e instanceof MtPeerNotFoundError || CANT_REACH.some((text) => tl.RpcError.is(e, text))) {
    return new SendError({ reason: 'unreachable' });
  }
  return new SendError({ reason: 'other' });
}

// The same link id gives the same random id, so Telegram turns down a Retry of a message it has.
function randomIdOf(key: string): Long {
  return Long.fromString(key.replace(/-/g, '').slice(0, 16), false, 16);
}

const LAST_SEEN: Record<string, string> = {
  online: 'online',
  recently: 'last seen recently',
  within_week: 'last seen within a week',
  within_month: 'last seen within a month',
  long_time_ago: 'last seen a long time ago',
};

function lastSeen(user: User): string {
  if (user.status === 'offline' && user.lastOnline) {
    const day = user.lastOnline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `last seen ${day}`;
  }
  return LAST_SEEN[user.status] ?? 'last seen a long time ago';
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function countOf(chat: TgChat, word: 'members' | 'subscribers', fallback: string): string {
  if (chat.membersCount !== null) return `${chat.membersCount.toLocaleString('en-US')} ${word}`;
  return chat.username ? `@${chat.username}` : fallback;
}

/** A chat row for a dialog peer, or null for a chat the user cannot send to. */
export function toChat(peer: User | TgChat): Chat | null {
  const id = peer.id as ChatId;
  const hasPhoto = peer.photo !== null;
  if (peer instanceof User) {
    if (peer.isSelf) {
      return {
        id,
        kind: 'self',
        name: 'Saved Messages',
        username: peer.username,
        detail: 'Your own chat',
        initials: '',
        hasPhoto: false,
      };
    }
    const name = peer.displayName;
    const base = { id, name, username: peer.username, initials: initialsOf(name), hasPhoto };
    if (peer.isBot) return { ...base, kind: 'bot', detail: `@${peer.username ?? ''}` };
    return { ...base, kind: 'person', detail: lastSeen(peer) };
  }
  const name = peer.displayName;
  const base = { id, name, username: peer.username, initials: initialsOf(name), hasPhoto };
  switch (peer.chatType) {
    case 'group':
    case 'supergroup':
      return { ...base, kind: 'group', detail: countOf(peer, 'members', 'Group') };
    case 'channel':
    case 'gigagroup':
      // isAdmin is true for any admin right; only these two can post.
      if (!peer.isCreator && !peer.adminRights?.postMessages) return null;
      return { ...base, kind: 'channel', detail: countOf(peer, 'subscribers', 'Channel') };
    default:
      return null;
  }
}

const BASE64_CHUNK = 8_192;

// A service worker has no Buffer, so base64 goes through btoa.
export function photoUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

type AccountUser = { id: number; firstName?: string | null; lastName?: string | null };

function toAccount(user: AccountUser): Account {
  const parts = [user.firstName, user.lastName].filter((p): p is string => !!p);
  const name = parts.join(' ') || 'Telegram user';
  const initials = (parts.length > 0 ? parts : [name])
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
  return { id: user.id, name, initials };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export interface MtcuteClient {
  get(): TelegramClient;
  /** Deletes the saved session so the next login starts clean (a session that ended from outside). */
  reset(): Promise<void>;
}

// One client for login and the chat list, so both use one saved session.
export function createMtcuteClient(
  config: { apiId: number; apiHash: string },
  device: Device,
  version: string,
): MtcuteClient {
  let client: TelegramClient | null = null;
  return {
    get() {
      client ??= new TelegramClient(mtcuteClientOptions(config, device, version));
      return client;
    },
    async reset() {
      const old = client;
      client = null;
      await old?.destroy().catch(() => {});
      await deleteDatabase();
    },
  };
}

export function createMtcuteAuth(client: MtcuteClient): TelegramAuth {
  let phone = '';
  let phoneCodeHash = '';
  const tg = () => client.get();
  const resetSession = () => client.reset();

  async function call<T>(run: (tg: TelegramClient, signal: AbortSignal) => Promise<T>) {
    try {
      return await run(tg(), AbortSignal.timeout(TIMEOUT_MS));
    } catch (e) {
      throw toAuthError(e);
    }
  }

  async function finishLogin<T extends AccountUser>(
    login: Promise<T>,
  ): Promise<Account | 'password'> {
    try {
      return toAccount(await login);
    } catch (e) {
      if (tl.RpcError.is(e, 'SESSION_PASSWORD_NEEDED')) return 'password';
      throw toAuthError(e);
    }
  }

  return {
    async restore() {
      let hadUser = false;
      try {
        const t = tg();
        await t.prepare();
        if ((await t.storage.self.fetch()) === null) return null;
        hadUser = true;
        const [user] = await t.call(
          { _: 'users.getUsers', id: [{ _: 'inputUserSelf' }] },
          { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (user?._ !== 'user') throw new AuthError('session-ended');
        return toAccount(user);
      } catch (e) {
        const error = toAuthError(e);
        if (error.kind === 'session-ended' && hadUser) await resetSession();
        throw error;
      }
    },

    async loginQr(onCode, signal) {
      const inner = new AbortController();
      const stop = () => inner.abort(signal.reason);
      if (signal.aborted) stop();
      signal.addEventListener('abort', stop, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => inner.abort(new DOMException('No QR code in time', 'TimeoutError')),
        TIMEOUT_MS,
      );
      try {
        return await finishLogin(
          tg().signInQr({
            onUrlUpdated: (url, expires) => {
              clearTimeout(timer);
              timer = undefined;
              onCode({ url, expires: expires.getTime() });
            },
            abortSignal: inner.signal,
          }),
        );
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
    },

    async sendCode(number) {
      const sent = await call((t, abortSignal) => t.sendCode({ phone: number, abortSignal }));
      if (!('phoneCodeHash' in sent)) throw new AuthError('offline');
      phone = number;
      phoneCodeHash = sent.phoneCodeHash;
      return { length: sent.length };
    },

    submitCode(code) {
      return finishLogin(
        tg().signIn({
          phone,
          phoneCodeHash,
          phoneCode: code,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
    },

    async submitPassword(password) {
      const user = await call((t, abortSignal) => t.checkPassword({ password, abortSignal }));
      return toAccount(user);
    },

    async logOut() {
      try {
        await call((t) => t.logOut());
      } catch (e) {
        if (!(e instanceof AuthError && e.kind === 'session-ended')) throw e;
        await resetSession();
      }
    },
  };
}

const MAX_CHATS = 200;

export function createMtcuteChats(client: MtcuteClient): TelegramChats {
  let peers = new Map<ChatId, User | TgChat>();

  return {
    async list() {
      const t = client.get();
      // The spike sent only after start had loaded the user (issue #4, Known).
      await t.start({});
      const next = new Map<ChatId, User | TgChat>();
      const chats: Chat[] = [];
      for await (const dialog of t.iterDialogs({ limit: MAX_CHATS })) {
        const chat = toChat(dialog.peer);
        if (!chat) continue;
        next.set(chat.id, dialog.peer);
        chats.push(chat);
      }
      const selfAt = chats.findIndex((chat) => chat.kind === 'self');
      const self = selfAt === -1 ? toChat(await t.getMe()) : chats.splice(selfAt, 1)[0];
      peers = next;
      return self ? [self, ...chats] : chats;
    },
    async photo(id) {
      try {
        const t = client.get();
        let peer = peers.get(id);
        if (!peer) {
          // The popup asks with no list before it, often in a worker that just woke up.
          await t.start({});
          peer = await t.getPeer(id);
          peers.set(id, peer);
        }
        if (!peer.photo) return null;
        return photoUrl(await t.downloadAsBuffer(peer.photo.small));
      } catch {
        return null;
      }
    },
  };
}

export function createMtcuteSend(client: MtcuteClient): TelegramSend {
  return {
    async account() {
      const t = client.get();
      await t.prepare();
      return (await t.storage.self.fetch())?.userId ?? null;
    },
    async sendText(chat, text, key, signal) {
      try {
        const t = client.get();
        // The spike sent only after start had loaded the user (issue #5, Known).
        await t.start({});
        // The send code stopped waiting during start: send nothing.
        if (signal.aborted) throw signal.reason;
        await t.sendText(chat, text, { randomId: randomIdOf(key), abortSignal: signal });
      } catch (e) {
        if (tl.RpcError.is(e, 'RANDOM_ID_DUPLICATE')) return;
        throw toSendError(e);
      }
    },
  };
}
