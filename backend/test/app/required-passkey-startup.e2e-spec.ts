import { ConfigService } from '@nestjs/config';
import { bootE2eApp } from '../utils/e2e-app';
import { SESSION_AUTHORITY_BOOT_TIMEOUT_MS } from '../utils/hook-timeouts';

// Failure: a beforeStart override bypasses env validation and starts an unenforced policy.
describe('temporary required-passkey startup refusal', () => {
  it(
    'rejects a web policy supplied after environment validation',
    async () => {
      await expect(
        bootE2eApp(0, {
          beforeStart: (app) => {
            app.get(ConfigService).set('auth.web.signIn', {
              requirePasskey: true,
            });
          },
        }),
      ).rejects.toThrow(/web.*plan 3.*passkey sign-in evidence/);
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );
});
