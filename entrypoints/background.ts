import { browser } from 'wxt/browser';
import { deviceLabel } from '../lib/device';
import { servePort } from '../lib/login/connection';
import { createLoginService, type LoginService } from '../lib/login/service';
import type { LoginView } from '../lib/login/state';
import { telegramConfig } from '../lib/telegram/config';
import { createMtcuteAuth } from '../lib/telegram/mtcute';

type Started = { service: LoginService; unsubscribe: () => void };

// One login service for all open settings tabs, so two tabs never run two QR logins.
// A hello with `fake` (fake builds only) swaps in a new service with a new fake.
function createHost(load: (fake?: string) => Promise<LoginService>): LoginService {
  const listeners = new Set<(view: LoginView) => void>();

  function start(fake?: string): Promise<Started> {
    return load(fake).then((service) => ({
      service,
      unsubscribe: service.subscribe((view) => {
        for (const listener of listeners) listener(view);
      }),
    }));
  }

  let current = start();

  return {
    send(command) {
      if (
        import.meta.env.WXT_TELEGRAM === 'fake' &&
        command.type === 'hello' &&
        command.fake !== undefined
      ) {
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
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      void current.then(({ service }) => service.stop());
    },
  };
}

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onInstalled.addListener(({ reason }) => {
      if (reason === 'install') void browser.runtime.openOptionsPage();
    });

    const device = deviceLabel(navigator as Parameters<typeof deviceLabel>[0]);

    const host = createHost(async (fake) => {
      if (import.meta.env.WXT_TELEGRAM === 'fake') {
        const { createFakeAuth, isFakeScenario } = await import('../lib/telegram/fake');
        const scenario = isFakeScenario(fake) ? fake : 'default';
        return createLoginService(createFakeAuth({ scenario }), device);
      }
      const auth = createMtcuteAuth(
        telegramConfig(),
        device,
        browser.runtime.getManifest().version,
      );
      return createLoginService(auth, device);
    });

    let ports = 0;
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== 'login') return;
      ports += 1;
      servePort(port, host);
      port.onDisconnect.addListener(() => {
        ports -= 1;
        if (ports === 0) host.stop();
      });
    });
  },
});
