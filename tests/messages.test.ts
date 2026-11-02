import { describe, expect, test } from 'vitest';
import { browser } from 'wxt/browser';
import { connect, defineGroup, memoryPath, runtimePath, serve, served } from '../lib/messages';

const group = defineGroup('sum', {
  double: async (_: null, n: number) => n * 2,
  fail: async (_: null): Promise<never> => {
    throw new Error('no account');
  },
  now: async (_: null) => new Date('2026-11-01T10:00:00Z'),
});

describe('the message path over the runtime', () => {
  test('answers an action over the runtime', async () => {
    // Given: the sum group served on the background's runtime
    serve([served(group, null)]);
    // When
    const doubled = await connect(group, runtimePath()).double(21);
    // Then
    expect(doubled).toBe(42);
  });

  test('gives a failed action back as an error over the runtime', async () => {
    // Given: as above
    serve([served(group, null)]);
    // When
    const failed = connect(group, runtimePath()).fail();
    // Then
    await expect(failed).rejects.toThrow('no account');
  });

  test('leaves a message of another group unanswered', async () => {
    // Given: as above
    serve([served(group, null)]);
    // When
    const reply = await browser.runtime.sendMessage({ group: 'other', action: 'double', args: [21] });
    // Then
    expect(reply).toBeUndefined();
  });
});

describe('the message path in memory', () => {
  test('answers an action in memory', async () => {
    // Given: the sum group, with no runtime listener
    const path = memoryPath([served(group, null)]);
    // When
    const doubled = await connect(group, path).double(21);
    // Then
    expect(doubled).toBe(42);
  });

  test('gives a failed action back as an error in memory', async () => {
    // Given: as above
    const path = memoryPath([served(group, null)]);
    // When
    const failed = connect(group, path).fail();
    // Then
    await expect(failed).rejects.toThrow('no account');
  });

  test('sends the reply as JSON in memory', async () => {
    // Given: as above
    const path = memoryPath([served(group, null)]);
    // When
    const now = await connect(group, path).now();
    // Then
    expect(now).toBe('2026-11-01T10:00:00.000Z');
  });
});
