import { ConfigService } from '@nestjs/config';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, browserAgent, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import { createNativeApplication } from '../../utils/native/native-authorize.fixtures';
import { openEngine } from '../../utils/native/native-auth-engine-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

describe('native auth consent browser identity', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it.each([
    ['approve', 'signedIn'],
    ['deny', 'authorizationDenied'],
  ] as const)(
    'binds %s consent to the account the browser identity endpoint returned',
    async (choice, expectedOutcome) => {
      const expectedUserId = await e2e.state.accounts.accountIdFor(
        SEED_USER.email,
      );
      if (!expectedUserId) throw new Error('seed account was missing');

      const harness = await openEngine(e2e, undefined, choice);
      const outcome = await harness.engine.signIn();

      expect(outcome.kind).toBe(expectedOutcome);
      expect(harness.consentAttempts).toEqual([
        {
          choice,
          transactionId: expect.any(String),
          expectedUserId,
        },
      ]);
    },
  );

  it('does not open or submit consent when the browser identity is signed out', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const harness = await openEngine(
      e2e,
      undefined,
      'approve',
      undefined,
      browser,
    );

    const outcome = await harness.engine.signIn();

    expect(outcome.kind).toBe('browserFailure');
    expect(harness.consentAttempts).toEqual([]);
  });
});
