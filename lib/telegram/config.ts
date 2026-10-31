export function telegramConfig(
  env: { WXT_API_ID?: string; WXT_API_HASH?: string } = import.meta.env,
): { apiId: number; apiHash: string } {
  const apiId = Number(env.WXT_API_ID);
  const apiHash = env.WXT_API_HASH;
  if (!env.WXT_API_ID || !Number.isInteger(apiId) || !apiHash) {
    throw new Error(
      'Missing WXT_API_ID or WXT_API_HASH in .env. Copy .env.example to .env and fill both.',
    );
  }
  return { apiId, apiHash };
}
