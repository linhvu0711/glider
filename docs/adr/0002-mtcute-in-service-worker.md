# mtcute runs in the service worker

The Telegram client is mtcute (`@mtcute/web`), running in the MV3 service worker with no offscreen document. We did not use GramJS, because its repo is archived and its browser build depends on localStorage and Node's Buffer. A spike on 2026-10-31 showed QR login and a send 5 seconds after the click, both from the service worker. mtcute's crypto is WebAssembly, so the manifest's content security policy needs `'wasm-unsafe-eval'`.
