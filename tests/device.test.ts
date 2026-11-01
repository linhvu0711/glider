import { describe, expect, test } from 'vitest';
import { deviceLabel } from '../lib/device';

describe('deviceLabel', () => {
  test('names Brave on macOS', () => {
    // Given: brands Chromium, Brave, Not;A=Brand; platform macOS
    const nav = {
      userAgentData: {
        brands: [{ brand: 'Chromium' }, { brand: 'Brave' }, { brand: 'Not;A=Brand' }],
        platform: 'macOS',
      },
    };
    // When / Then
    expect(deviceLabel(nav)).toBe('Brave on macOS');
  });

  test('names Brave from navigator.brave', () => {
    // Given: navigator.brave exists
    const nav = {
      brave: {},
      userAgentData: { brands: [{ brand: 'Chromium' }], platform: 'Windows' },
    };
    // When / Then
    expect(deviceLabel(nav)).toBe('Brave on Windows');
  });

  test('names Chrome on Windows', () => {
    // Given: brands Google Chrome, Chromium; platform Windows
    const nav = {
      userAgentData: {
        brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }],
        platform: 'Windows',
      },
    };
    // When / Then
    expect(deviceLabel(nav)).toBe('Chrome on Windows');
  });

  test('names Edge on Linux', () => {
    // Given: brands Microsoft Edge, Chromium; platform Linux
    const nav = {
      userAgentData: {
        brands: [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }],
        platform: 'Linux',
      },
    };
    // When / Then
    expect(deviceLabel(nav)).toBe('Edge on Linux');
  });

  test('names Chromium with no OS', () => {
    // Given: brands Chromium; platform ''
    const nav = { userAgentData: { brands: [{ brand: 'Chromium' }], platform: '' } };
    // When / Then
    expect(deviceLabel(nav)).toBe('Chromium');
  });
});
