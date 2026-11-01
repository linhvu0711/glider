import { browser } from 'wxt/browser';
import { serveChats } from '../lib/chats/connection';
import { deviceLabel } from '../lib/device';
import { servePort } from '../lib/login/connection';
import { createHost } from '../lib/login/host';
import { createLoginService } from '../lib/login/service';
import { serveSend } from '../lib/send/connection';
import { createSendService } from '../lib/send/service';
import { telegramConfig } from '../lib/telegram/config';
import type { TelegramChats } from '../lib/telegram/chats';
import {
  createFakeAuth,
  createFakeChats,
  createFakeSend,
  fakeSession,
  isFakeScenario,
} from '../lib/telegram/fake';
import {
  createMtcuteAuth,
  createMtcuteChats,
  createMtcuteClient,
  createMtcuteSend,
  type MtcuteClient,
} from '../lib/telegram/mtcute';

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onInstalled.addListener(({ reason }) => {
      if (reason === 'install') void browser.runtime.openOptionsPage();
    });

    const device = deviceLabel(navigator as Parameters<typeof deviceLabel>[0]);
    const fake = import.meta.env.WXT_TELEGRAM === 'fake';

    // One client for login, the chat list, and the send, made on first use:
    // telegramConfig() throws when .env lacks the app key.
    let made: MtcuteClient | null = null;
    const mtcute = () =>
      (made ??= createMtcuteClient(telegramConfig(), device, browser.runtime.getManifest().version));
    const client: MtcuteClient = { get: () => mtcute().get(), reset: () => mtcute().reset() };

    // Set with each login service, so the chat list follows the same fake scenario.
    let chats: TelegramChats | null = null;
    serveChats(() => chats);

    const sender = createSendService(fake ? createFakeSend() : createMtcuteSend(client));
    serveSend(sender);
    void sender.start();

    const host = createHost(async (scenarioName) => {
      if (fake) {
        if (scenarioName !== undefined) await fakeSession.removeValue();
        const scenario = isFakeScenario(scenarioName) ? scenarioName : 'default';
        chats = createFakeChats({ scenario });
        return createLoginService(createFakeAuth({ scenario }), device);
      }
      chats = createMtcuteChats(client);
      return createLoginService(createMtcuteAuth(client), device);
    }, { fake });

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
