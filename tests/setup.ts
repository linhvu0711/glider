import { cleanup } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, vi } from 'vitest';

// Testing Library only knows fake timers through a `jest` global; without it,
// its own waits never finish once vi.useFakeTimers() is on.
Object.assign(globalThis, {
  jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
});

afterEach(() => {
  fakeBrowser.reset();
  cleanup();
});
