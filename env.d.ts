interface ImportMetaEnv {
  readonly WXT_API_ID?: string;
  readonly WXT_API_HASH?: string;
  readonly WXT_TELEGRAM?: 'fake';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
