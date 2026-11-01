import { describe, expect, test } from 'vitest';
import { checkPhone } from '../lib/phone';

describe('checkPhone', () => {
  test('accepts a full Vietnamese number', () => {
    // Given: '+84', '912 345 678'
    // When
    const result = checkPhone('+84', '912 345 678');
    // Then
    expect(result).toEqual({ ok: true, phone: '84912345678' });
  });

  test('says the number is too short', () => {
    // Given: '+84', '12'
    // When
    const result = checkPhone('+84', '12');
    // Then
    expect(result).toEqual({ ok: false, error: 'This number is too short.' });
  });

  test('says the number is too long', () => {
    // Given: '+84', '9123456789012345'
    // When
    const result = checkPhone('+84', '9123456789012345');
    // Then
    expect(result).toEqual({ ok: false, error: 'This number is too long.' });
  });

  test('says to use digits only', () => {
    // Given: '+84', '91234abc'
    // When
    const result = checkPhone('+84', '91234abc');
    // Then
    expect(result).toEqual({ ok: false, error: 'Use digits only.' });
  });

  test('asks for the country code', () => {
    // Given: '84a', '912345678'
    // When
    const result = checkPhone('84a', '912345678');
    // Then
    expect(result).toEqual({ ok: false, error: 'Enter a country code, like +84.' });
  });
});
