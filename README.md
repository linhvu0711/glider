# Glider

A Chrome extension that sends the current page's link to one Telegram chat from your own account.

## Set up

1. Run `pnpm install`.
2. Copy `.env.example` to `.env`. Fill `WXT_API_ID` and `WXT_API_HASH` from my.telegram.org.
3. Run `pnpm build`.
4. Open `chrome://extensions` (or `brave://extensions`), turn on Developer mode, click Load unpacked, and pick `.output/chrome-mv3`.

## Check

```sh
pnpm compile
pnpm test
```
