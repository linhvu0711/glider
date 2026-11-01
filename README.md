# Glider

A Chrome extension that sends the current page's link to one Telegram chat from your own account.

## Set up

1. Run `pnpm install`.
2. Copy `.env.example` to `.env`. Fill `WXT_API_ID` and `WXT_API_HASH` from my.telegram.org.
3. Run `pnpm build`.
4. Open `chrome://extensions` (or `brave://extensions`), turn on Developer mode, click Load unpacked, and pick `.output/chrome-mv3`.
5. Pin Glider to the toolbar. On a web page, click the Glider icon or press ⌘⇧S (Ctrl+Shift+S on Windows and Linux) to send the page. Undo in the popup within 5 seconds stops it.

## Check

```sh
pnpm compile
pnpm test
```

## Fake Telegram build

`pnpm build:fake` builds Glider with a fake Telegram that gives fixed answers, for tests and screen recordings. It never talks to Telegram.

Open the settings page with `?fake=<scenario>` to pick one: `default`, `slow`, `qr-scan`, `qr-password`, `qr-expire`, `offline`, `revoked`, `chats-slow`, `chats-error`.

- A page whose address ends `#fail=offline`, `#fail=logged-out`, `#fail=unreachable`, `#fail=other`, or `#fail=wait-<n>` fails its first send with that reason. Retry sends it.
- Phone `+84 912345678` with code `12345` logs in as Minh Anh.
- Phone `+84 900000002` with code `12345` asks for the 2-step password `glider-pass`.
- Phone `+84 999999999` is a number Telegram does not know.
- Code `00000` is expired.
- Logged in, step 2 lists seven fixed chats. `chats-slow` loads them after 5 seconds. `chats-error` fails the first load, and Try again works.
