import type { LoginService } from './service';
import type { LoginView } from './state';

type Started = { service: LoginService; unsubscribe: () => void };

// One login service for all open settings tabs, so two tabs never run two QR logins.
// A hello with `fake` (fake builds only) swaps in a new service with a new fake.
export function createHost(
  load: (fake?: string) => Promise<LoginService>,
  { fake }: { fake: boolean },
): LoginService {
  const listeners = new Set<(view: LoginView) => void>();
  // A tab that connects late gets this at once; its own hello may change nothing.
  let last: LoginView | null = null;

  function start(scenario?: string): Promise<Started> {
    return load(scenario).then((service) => ({
      service,
      unsubscribe: service.subscribe((view) => {
        last = view;
        for (const listener of listeners) listener(view);
      }),
    }));
  }

  let current = start();

  return {
    send(command) {
      if (fake && command.type === 'hello' && command.fake !== undefined) {
        const old = current;
        current = start(command.fake);
        void old.then(({ service, unsubscribe }) => {
          unsubscribe();
          service.stop();
        });
      }
      void current.then(({ service }) => service.send(command));
    },
    subscribe(listener) {
      listeners.add(listener);
      if (last) listener(last);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      void current.then(({ service }) => service.stop());
    },
  };
}
