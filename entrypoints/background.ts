import { browser } from 'wxt/browser';
import { deviceLabel, deviceName } from '../lib/device';
import { serveLogin } from '../lib/login/connection';
import { createLoginService } from '../lib/login/service';
import { serve, served } from '../lib/messages';
import { sendGroup } from '../lib/send/connection';
import { createSendService } from '../lib/send/service';
import { chatsGroup, createChatList } from '../lib/target-chat';
import { telegramConfig } from '../lib/telegram/config';
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

    const telegramSend = fake ? createFakeSend() : createMtcuteSend(client);
    // Made only in the fake build, so the real build drops the fake.
    const fakeChats = fake ? createFakeChats({ scenario: 'default' }) : null;
    const chats = fakeChats ?? createMtcuteChats(client);

    const sender = createSendService(telegramSend);
    serve([
      served(sendGroup, sender),
      served(chatsGroup, createChatList(() => telegramSend.account(), chats)),
    ]);
    void sender.start();

    serveLogin(async (scenarioName) => {
      if (fake) {
        if (scenarioName !== undefined) await fakeSession.removeValue();
        const scenario = isFakeScenario(scenarioName) ? scenarioName : 'default';
        fakeChats?.setScenario(scenario);
        return createLoginService(createFakeAuth({ scenario }), deviceName(device));
      }
      return createLoginService(createMtcuteAuth(client), deviceName(device));
    }, { fake });
  },
});
