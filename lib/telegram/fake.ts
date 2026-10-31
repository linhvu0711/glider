import { AuthError, type Account, type QrCode, type TelegramAuth } from './auth';

export type FakeScenario =
  | 'default'
  | 'slow'
  | 'qr-scan'
  | 'qr-password'
  | 'qr-expire'
  | 'offline'
  | 'revoked';

const QR_LIFE_MS = 30_000;
const QR_EXPIRE_LIFE_MS = 2_000;
const SLOW_MS = 5_000;

export function createFakeAuth({ scenario }: { scenario: FakeScenario }): TelegramAuth {
  let tokenCount = 0;
  const qrLife = scenario === 'qr-expire' ? QR_EXPIRE_LIFE_MS : QR_LIFE_MS;
  const answerDelay = scenario === 'slow' ? SLOW_MS : 0;

  return {
    async restore() {
      return null;
    },
    loginQr(onCode: (code: QrCode) => void, signal: AbortSignal) {
      return new Promise<Account | 'password'>((_resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const emit = () => {
          tokenCount += 1;
          onCode({
            url: `tg://login?token=fake-${tokenCount}`,
            expires: Date.now() + qrLife,
          });
          timer = setTimeout(emit, qrLife);
        };
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new AuthError('offline'));
          },
          { once: true },
        );
        timer = setTimeout(emit, answerDelay);
      });
    },
    async sendCode() {
      throw new AuthError('offline');
    },
    async submitCode() {
      throw new AuthError('offline');
    },
    async submitPassword() {
      throw new AuthError('offline');
    },
    async logOut() {},
  };
}
