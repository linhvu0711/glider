import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
    developmentIndicator: false,
  },
  manifest: {
    name: 'Glider',
    description: 'Send the page link to Telegram.',
    // activeTab reads the page only after the user opens the popup, and shows no install warning.
    permissions: ['storage', 'activeTab'],
    action: { default_title: 'Glider' },
    // The shortcut opens the popup like a click, and opening the popup is the send.
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
