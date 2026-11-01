import { TelegramClient, tl } from '@mtcute/web';
import { AuthError, type Account, type TelegramAuth } from './auth';

const TIMEOUT_MS = 15_000;
const DATABASE = 'glider';

export function mtcuteClientOptions(
  config: { apiId: number; apiHash: string },
  device: string,
  version: string,
) {
  const [, os] = device.split(' on ');
  return {
    apiId: config.apiId,
    apiHash: config.apiHash,
    storage: DATABASE,
    initConnectionOptions: {
      deviceModel: `Glider · ${device}`,
      appVersion: version,
      systemVersion: os ?? 'unknown',
    },
  };
}

const SESSION_ENDED = [
  'AUTH_KEY_UNREGISTERED',
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

function toAccount(user: { firstName?: string | null; lastName?: string | null }): Account {
  const parts = [user.firstName, user.lastName].filter((p): p is string => !!p);
  const name = parts.join(' ') || 'Telegram user';
  const initials = (parts.length > 0 ? parts : [name])
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
  return { name, initials };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export function createMtcuteAuth(
  config: { apiId: number; apiHash: string },
  device: string,
  version: string,
): TelegramAuth {
  let client: TelegramClient | null = null;
  let phone = '';
  let phoneCodeHash = '';

  function tg(): TelegramClient {
    client ??= new TelegramClient(mtcuteClientOptions(config, device, version));
    return client;
  }

  // Deletes the saved session so the next login starts clean (a session that ended from outside).
  async function resetSession() {
    const old = client;
    client = null;
    await old?.destroy().catch(() => {});
    await deleteDatabase();
  }

  async function call<T>(run: (tg: TelegramClient, signal: AbortSignal) => Promise<T>) {
    try {
      return await run(tg(), AbortSignal.timeout(TIMEOUT_MS));
    } catch (e) {
      throw toAuthError(e);
    }
  }

  async function finishLogin<T extends { firstName?: string | null; lastName?: string | null }>(
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
