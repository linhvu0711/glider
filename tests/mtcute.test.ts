import { Chat, Long, tl, User } from '@mtcute/web';
import { describe, expect, test } from 'vitest';
import { mtcuteClientOptions, photoUrl, toAuthError, toChat } from '../lib/telegram/mtcute';

describe('mtcute adapter edges', () => {
  test('names the session Glider with the browser and OS', () => {
    // Given: config, device Brave on macOS, version 0.1.0
    const config = { apiId: 12345, apiHash: 'abc123' };
    // When
    const options = mtcuteClientOptions(config, 'Brave on macOS', '0.1.0');
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
