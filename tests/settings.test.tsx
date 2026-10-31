import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../entrypoints/options/App';

describe('settings page', () => {
  test('shows Not logged in in the header', () => {
    // Given: <App /> rendered with no connection yet
    // When
    render(<App />);
    // Then
    expect(screen.getByRole('heading', { name: 'Glider' })).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Not logged in')).toBeTruthy();
    expect(
      screen.getByText(
        'Glider sends from your own Telegram account. Your login stays on this computer.',
      ),
    ).toBeTruthy();
  });
});
