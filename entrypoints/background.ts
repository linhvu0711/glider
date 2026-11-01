import { browser } from 'wxt/browser';
import { serveChats } from '../lib/chats/connection';
import { deviceLabel } from '../lib/device';
import { servePort } from '../lib/login/connection';
import { createHost } from '../lib/login/host';
import { createLoginService } from '../lib/login/service';
import { telegramConfig } from '../lib/telegram/config';
import type { TelegramChats } from '../lib/telegram/chats';
import { createFakeAuth, createFakeChats, fakeSession, isFakeScenario } from '../lib/telegram/fake';
import {
  createMtcuteAuth,
  createMtcuteChats,
  createMtcuteClient,
  type MtcuteClient,
} from '../lib/telegram/mtcute';

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onInstalled.addListener(({ reason }) => {
      if (reason === 'install') void browser.runtime.openOptionsPage();
    });

    const device = deviceLabel(navigator as Parameters<typeof deviceLabel>[0]);

    // Set with each login service, so the chat list follows the same fake scenario.
    let chats: TelegramChats | null = null;
    let client: MtcuteClient | null = null;
    serveChats(() => chats);

    const host = createHost(async (fake) => {
      if (import.meta.env.WXT_TELEGRAM === 'fake') {
        if (fake !== undefined) await fakeSession.removeValue();
        const scenario = isFakeScenario(fake) ? fake : 'default';
        chats = createFakeChats({ scenario });
        return createLoginService(createFakeAuth({ scenario }), device);
      }
      client ??= createMtcuteClient(
        telegramConfig(),
        device,
        browser.runtime.getManifest().version,
      );
      chats = createMtcuteChats(client);
      return createLoginService(createMtcuteAuth(client), device);
    }, { fake: import.meta.env.WXT_TELEGRAM === 'fake' });

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
