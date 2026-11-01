import { tl } from '@mtcute/web';
import { describe, expect, test } from 'vitest';
import { mtcuteClientOptions, toAuthError } from '../lib/telegram/mtcute';

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
