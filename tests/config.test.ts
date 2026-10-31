import { describe, expect, test } from 'vitest';
import { telegramConfig } from '../lib/telegram/config';

describe('telegramConfig', () => {
  test('reads the app key from the build env', () => {
    // Given: env with both names
    const env = { WXT_API_ID: '12345', WXT_API_HASH: 'abc123' };
    // When
    const config = telegramConfig(env);
    // Then
    expect(config).toEqual({ apiId: 12345, apiHash: 'abc123' });
  });

  test('fails with a clear message when the app key is missing', () => {
    // Given: an empty id
    const env = { WXT_API_ID: '', WXT_API_HASH: 'abc123' };
    // When / Then
    expect(() => telegramConfig(env)).toThrow(
      'Missing WXT_API_ID or WXT_API_HASH in .env. Copy .env.example to .env and fill both.',
    );
  });
});
