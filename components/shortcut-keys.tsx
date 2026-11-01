import { keysFor } from '../lib/device';

export function ShortcutKeys() {
  const keys = keysFor(navigator as Parameters<typeof keysFor>[0]);
  return (
    <span className="keys" aria-label={keys.join('+')}>
      {keys.map((key) => (
        <kbd key={key} className="key" aria-hidden="true">
          {key}
        </kbd>
      ))}
    </span>
  );
}
