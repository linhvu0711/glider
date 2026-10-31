import { cleanup } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach } from 'vitest';

afterEach(() => {
  fakeBrowser.reset();
  cleanup();
});
