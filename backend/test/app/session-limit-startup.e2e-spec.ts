import { ConfigService } from '@nestjs/config';
import { bootE2eApp } from '../utils/e2e-app';
import { SESSION_AUTHORITY_BOOT_TIMEOUT_MS } from '../utils/hook-timeouts';

// Failure: a beforeStart override bypasses validation and starts above-bound admin sessions.
describe('session limit startup refusal', () => {
  it(
    'rejects an above-bound admin policy supplied after environment validation',
    async () => {
      await expect(
        bootE2eApp(0, {
          beforeStart: (app) => {
            const config = app.get(ConfigService);
            config.set('cors.adminUrl', 'https://admin.example.test');
            config.set('auth.admin.session', {
              absoluteHours: 8,
              idleMinutes: 16,
              cap: 5,
            });
          },
        }),
      ).rejects.toThrow(/AUTH_ADMIN_SESSION.*admin limits/);
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );

  // Failure: a typed ConfigService override bypasses native pair validation.
  it.each([
    { field: 'absoluteHours', unbound: { absoluteHours: 25, idleMinutes: 5 } },
    { field: 'idleMinutes', unbound: { absoluteHours: 1, idleMinutes: 31 } },
  ])(
    'rejects a longer unbound $field supplied after environment validation',
    async ({ field, unbound }) => {
      await expect(
        bootE2eApp(0, {
          beforeStart: (app) => {
            const config = app.get(ConfigService);
            config.set('auth.nativeEnabled', true);
            config.set('auth.nativeApplications', [
              {
                clientId: 'mobile-limits',
                displayName: 'Mobile limits',
                redirectUris: ['https://mobile.example.test/callback'],
                allowedScopes: ['api'],
                session: {
                  bound: { absoluteHours: 24, idleMinutes: 30 },
                  unbound,
                },
              },
            ]);
          },
        }),
      ).rejects.toThrow(
        new RegExp(
          `AUTH_NATIVE_APPLICATIONS.*mobile-limits.*unbound.${field}.*reduce`,
        ),
      );
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );
});
