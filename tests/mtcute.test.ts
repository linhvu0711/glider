import { Chat, Long, MtArgumentError, MtPeerNotFoundError, tl, User } from '@mtcute/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ChatId } from '../lib/telegram/chats';
import type { SendError } from '../lib/telegram/send';
import {
  createMtcuteChats,
  createMtcuteSend,
  mtcuteClientOptions,
  photoUrl,
  toAuthError,
  toChat,
  toSendError,
  type MtcuteClient,
} from '../lib/telegram/mtcute';

describe('mtcute adapter edges', () => {
  test('names the session Glider with the browser and OS', () => {
    // Given: config, device Brave on macOS, version 0.1.0
    const config = { apiId: 12345, apiHash: 'abc123' };
    // When
    const options = mtcuteClientOptions(config, { browser: 'Brave', os: 'macOS' }, '0.1.0');
    // Then
    expect(options).toEqual({
      apiId: 12345,
      apiHash: 'abc123',
      storage: 'glider',
      initConnectionOptions: {
        deviceModel: 'Glider · Brave on macOS',
        appVersion: '0.1.0',
        systemVersion: 'macOS',
      },
    });
  });

  test('tells Telegram the system is unknown when the browser does not say', () => {
    // Given: config, device Chromium with no OS, version 0.1.0
    const config = { apiId: 12345, apiHash: 'abc123' };
    // When
    const options = mtcuteClientOptions(config, { browser: 'Chromium', os: null }, '0.1.0');
    // Then
    expect(options.initConnectionOptions).toEqual({
      deviceModel: 'Glider · Chromium',
      appVersion: '0.1.0',
      systemVersion: 'unknown',
    });
  });

  test('maps Telegram errors to login errors', () => {
    // Given: Telegram's error texts and a plain network error
    const errors = [
      new tl.RpcError(400, 'PHONE_NUMBER_INVALID'),
      new tl.RpcError(400, 'PHONE_CODE_INVALID'),
      new tl.RpcError(400, 'PHONE_CODE_EXPIRED'),
      new tl.RpcError(400, 'PASSWORD_HASH_INVALID'),
      new tl.RpcError(401, 'SESSION_REVOKED'),
      new tl.RpcError(401, 'AUTH_KEY_UNREGISTERED'),
      new tl.RpcError(400, 'TIMEOUT'),
      new Error('socket closed'),
    ];
    // When
    const kinds = errors.map((e) => toAuthError(e).kind);
    // Then
    expect(kinds).toEqual([
      'bad-phone',
      'bad-code',
      'code-expired',
      'bad-password',
      'session-ended',
      'session-ended',
      'offline',
      'offline',
    ]);
  });
});

describe('mtcute chat list edges', () => {
  const NO_PHOTO: tl.TypeChatPhoto = { _: 'chatPhotoEmpty' };

  test('maps Telegram peers to chat rows', () => {
    // Given: a self user, a bot, two people, a basic group, and a channel the user created
    const peers = [
      new User({ _: 'user', id: 4000, self: true, firstName: 'Linh' }),
      new User({ _: 'user', id: 4004, bot: true, firstName: 'Hermes', username: 'hermes_notes_bot' }),
      new User({
        _: 'user',
        id: 4002,
        firstName: 'Minh',
        lastName: 'Anh',
        status: { _: 'userStatusRecently' },
      }),
      new User({
        _: 'user',
        id: 4008,
        firstName: 'An',
        status: { _: 'userStatusOffline', wasOnline: 1793188800 },
      }),
      new Chat({
        _: 'chat',
        id: 4003,
        title: 'Design Crew',
        photo: NO_PHOTO,
        participantsCount: 12,
        date: 0,
        version: 1,
      }),
      new Chat({
        _: 'channel',
        id: 4006,
        title: 'Glider News',
        accessHash: Long.fromNumber(1),
        broadcast: true,
        creator: true,
        participantsCount: 1204,
        photo: NO_PHOTO,
        date: 0,
      }),
    ];
    // When
    const chats = peers.map(toChat);
    // Then
    expect(chats).toMatchObject([
      { kind: 'self', name: 'Saved Messages', detail: 'Your own chat' },
      { kind: 'bot', name: 'Hermes', detail: '@hermes_notes_bot', initials: 'H' },
      { kind: 'person', name: 'Minh Anh', detail: 'last seen recently', initials: 'MA' },
      { kind: 'person', name: 'An', detail: 'last seen 28 Oct' },
      { kind: 'group', id: -4003, detail: '12 members', initials: 'DC' },
      { kind: 'channel', id: -1000000004006, detail: '1,204 subscribers', initials: 'GN' },
    ]);
  });

  test('leaves out channels the user cannot post in', () => {
    // Given: a broadcast channel with no creator flag and no admin rights
    const channel = new Chat({
      _: 'channel',
      id: 4007,
      title: 'News',
      accessHash: Long.fromNumber(1),
      broadcast: true,
      photo: NO_PHOTO,
      date: 0,
    });
    // When
    const chat = toChat(channel);
    // Then
    expect(chat).toBeNull();
  });

  test('turns photo bytes into a jpeg data URL', () => {
    // Given: the first three bytes of a JPEG
    const bytes = new Uint8Array([255, 216, 255]);
    // When
    const url = photoUrl(bytes);
    // Then
    expect(url).toBe('data:image/jpeg;base64,/9j/');
  });
});

describe('mtcute chat photo', () => {
  test('loads the photo of a chat that was not listed first', async () => {
    // Given: a stub client that knows chat 7001 and its small photo; no list ran
    const calls: string[] = [];
    const tg = {
      start: async () => {
        calls.push('start');
      },
      getPeer: async (id: number) => {
        calls.push(`getPeer ${id}`);
        return { photo: { small: 'small-7001' } };
      },
      downloadAsBuffer: async (location: string) => {
        calls.push(`download ${location}`);
        return new Uint8Array([255, 216, 255]);
      },
    };
    const stub = { get: () => tg, reset: async () => {} } as unknown as MtcuteClient;
    // When
    const url = await createMtcuteChats(stub).photo(7001 as ChatId);
    // Then
    expect([url, calls]).toEqual([
      'data:image/jpeg;base64,/9j/',
      ['start', 'getPeer 7001', 'download small-7001'],
    ]);
  });
});

describe('mtcute send', () => {
  test('sends the link as text through mtcute', async () => {
    // Given: a stub client that notes each call; the saved self is user 7100
    const calls: string[] = [];
    const tg = {
      prepare: async () => {
        calls.push('prepare');
      },
      storage: {
        self: {
          fetch: async () => {
            calls.push('fetch');
            return { userId: 7100, isBot: false, isPremium: false, usernames: [] };
          },
        },
      },
      start: async () => {
        calls.push('start');
      },
      sendText: async (chat: number, text: string) => {
        calls.push(`sendText ${chat} ${text}`);
      },
    };
    const stub = { get: () => tg, reset: async () => {} } as unknown as MtcuteClient;
    // When
    const send = createMtcuteSend(stub);
    const account = await send.account();
    await send.sendText(
      7001 as ChatId,
      'https://example.com/',
      '123e4567-e89b-12d3-a456-426614174000',
      new AbortController().signal,
    );
    // Then
    expect([account, calls]).toEqual([
      7100,
      ['prepare', 'fetch', 'start', 'sendText 7001 https://example.com/'],
    ]);
  });
});

// A stub client for the send: `start` and `sendText` run the given functions and note each call.
function sendStub({
  start = async () => {},
  sendText = async () => {},
}: {
  start?: () => Promise<void>;
  sendText?: (params: unknown) => Promise<void>;
} = {}) {
  const calls: string[] = [];
  const tg = {
    start: async () => {
      calls.push('start');
      await start();
    },
    sendText: async (_chat: number, _text: string, params: unknown) => {
      calls.push('sendText');
      await sendText(params);
    },
  };
  return { calls, stub: { get: () => tg, reset: async () => {} } as unknown as MtcuteClient };
}

describe('mtcute send failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('maps Telegram errors to send failures', () => {
    // Given
    const errors: unknown[] = [
      new tl.RpcError(400, 'RANDOM_ID_DUPLICATE'),
      tl.RpcError.fromTl({ _: 'mt_rpc_error', errorCode: 420, errorMessage: 'FLOOD_WAIT_30' }),
      tl.RpcError.fromTl({ _: 'mt_rpc_error', errorCode: 420, errorMessage: 'SLOWMODE_WAIT_12' }),
      new tl.RpcError(401, 'AUTH_KEY_UNREGISTERED'),
      new tl.RpcError(401, 'SESSION_REVOKED'),
      new MtArgumentError('Neither phone nor bot token were provided'),
      new tl.RpcError(403, 'CHAT_WRITE_FORBIDDEN'),
      new tl.RpcError(403, 'USER_IS_BLOCKED'),
      new tl.RpcError(400, 'CHANNEL_PRIVATE'),
      new MtPeerNotFoundError('no peer'),
      new tl.RpcError(400, 'PEER_FLOOD'),
      new Error('socket closed'),
    ];
    // When
    const failures = errors.map((e) => toSendError(e).failure);
    // Then
    expect(failures).toEqual([
      { reason: 'repeat' },
      { reason: 'wait', seconds: 30 },
      { reason: 'wait', seconds: 12 },
      { reason: 'logged-out' },
      { reason: 'logged-out' },
      { reason: 'logged-out' },
      { reason: 'unreachable' },
      { reason: 'unreachable' },
      { reason: 'unreachable' },
      { reason: 'unreachable' },
      { reason: 'other' },
      { reason: 'other' },
    ]);
  });

  test("sends with the link's random id and the send's signal", async () => {
    // Given: a stub client that keeps the send's params
    let params: { randomId: Long; abortSignal: unknown } | undefined;
    const { stub } = sendStub({
      sendText: async (p) => {
        params = p as typeof params;
      },
    });
    const signal = new AbortController().signal;
    // When
    await createMtcuteSend(stub).sendText(
      7001 as ChatId,
      'https://example.com/',
      '123e4567-e89b-12d3-a456-426614174000',
      signal,
    );
    // Then
    expect([params?.randomId.toString(16), params?.abortSignal === signal]).toEqual([
      '123e4567e89b12d3',
      true,
    ]);
  });

  test('sends nothing once the send code stops waiting', async () => {
    // Given: a start that ends after the send code stopped waiting
    const limit = new AbortController();
    const { stub, calls } = sendStub({
      start: async () => {
        limit.abort(new Error('stop'));
      },
    });
    // When
    const failure = await createMtcuteSend(stub)
      .sendText(7001 as ChatId, 'https://example.com/', 'k', limit.signal)
      .catch((e: SendError) => e.failure);
    // Then
    expect([failure, calls]).toEqual([{ reason: 'other' }, ['start']]);
  });
});
