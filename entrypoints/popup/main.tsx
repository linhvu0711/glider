import React from 'react';
import ReactDOM from 'react-dom/client';
import { browser, type Browser } from 'wxt/browser';
import { connectChats } from '../../lib/chats/connection';
import { connectSend } from '../../lib/send/connection';
import type { Page } from '../../lib/send/state';
import Popup from './Popup';
import '../../components/base.css';
import './style.css';

// With activeTab, the tab's address and title are readable only because the user opened the popup.
function pageOf(tab: Browser.tabs.Tab | undefined): Page | null {
  if (!tab?.url) return null;
  return { url: tab.url, title: tab.title || tab.url, icon: tab.favIconUrl || null };
}

const sender = connectSend();
// Opening the popup is the send. It runs once here, outside React: StrictMode runs effects
// twice in dev, and a second send would say the page is already waiting.
const opened = browser.tabs
  .query({ active: true, currentWindow: true })
  .then(([tab]) => sender.open(pageOf(tab)));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup
      sender={sender}
      opened={opened}
      chats={connectChats()}
      openSettings={() => void browser.runtime.openOptionsPage()}
      // openOptionsPage takes no address, so step 2 opens in a new tab.
      openChatSettings={() =>
        void browser.tabs.create({ url: browser.runtime.getURL('/options.html#chat') })
      }
      close={() => window.close()}
    />
  </React.StrictMode>,
);
