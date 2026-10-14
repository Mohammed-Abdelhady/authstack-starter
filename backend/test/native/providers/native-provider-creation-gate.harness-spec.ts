// feature:oauth-core:start
// feature:google:start
import { GoogleOAuthStrategy } from '../../../src/auth/oauth/strategies/google-oauth.strategy';
import {
  configFor,
  mockFetch,
  type SigningKey,
} from '../../../src/auth/oauth/strategies/oauth-strategy.harness-spec';
import {
  createSigningKey,
  signedNativeToken,
  NATIVE_AUDIENCE,
} from '../../../src/auth/oauth/strategies/native-provider-proof.harness-spec';
import { resetJwksCache } from '../../../src/auth/oauth/utils/id-token.util';
import { ProviderSignInStore } from '../../../src/auth/oauth/stores/provider-sign-in.store';
import { AccountLinkingService } from '../../../src/user/services/account-linking.service';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import { ACCOUNT_CREATION_METHOD } from '../../../src/auth/constants/account-creation';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import type { NativeApplicationConfiguration } from '../../../src/config/types/native-application.type';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../../utils/account-creation-policy';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
  type StartedLifecycleAttempt,
} from '../lifecycle/native-lifecycle.fixtures';

const EMAIL = 'native-provider-gate@example.test';
const PROVIDER_ID = 'google';
const SUBJECT = 'native-provider-gate-subject';
const ISSUER = 'https://accounts.google.com';
const JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const FETCH = global.fetch;
const APPLICATION: NativeApplicationConfiguration = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Provider gate client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: {
    providers: [
      {
        id: PROVIDER_ID,
        mode: 'googleIdentityToken',
        webClientId: NATIVE_AUDIENCE,
      },
    ],
  },
};

export function describeNativeProviderCreationGate(): void {
  describe('native provider account creation policy', () => {
    let e2e: E2eApp;
    let key: SigningKey;
    let policy: SwitchableAccountCreationPolicy;
    beforeAll(async () => {
      key = await createSigningKey();
      e2e = await bootE2eApp(0, {
        nativeEnabled: true,
        nativeCustomSchemeAllowed: true,
        nativeApplications: [APPLICATION],
        browserStrategy: new GoogleOAuthStrategy(
          configFor(PROVIDER_ID, {
            clientId: 'web-client',
            clientSecret: 'test-secret',
          }),
        ),
      });
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
    beforeEach(async () => {
      e2e.clock.set(TEST_NOW);
      await e2e.reset();
      policy = installAccountCreationPolicy(e2e.app);
      jest.useFakeTimers({
        now: TEST_NOW,
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
    });
    afterEach(() => {
      global.fetch = FETCH;
      resetJwksCache();
      jest.useRealTimers();
      jest.restoreAllMocks();
    });
    afterAll(async () => {
      await e2e?.close();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    async function verify(attempt: StartedLifecycleAttempt) {
      const identityToken = await signedNativeToken(key, ISSUER, {
        iat: TEST_NOW.getTime() / 1000,
        exp: TEST_NOW.getTime() / 1000 + 600,
        nonce: attempt.providerNonceDigest,
        email: EMAIL,
        sub: SUBJECT,
      });
      mockFetch([{ url: JWKS, body: key.jwks }]);
      return postLifecycle(e2e, attempt, 'provider', {
        kind: 'googleIdentityToken',
        identityToken,
        nonceDigest: attempt.providerNonceDigest,
      });
    }

    function linkedAccount() {
      return e2e.app.get(ProviderSignInStore).findByIdentity({
        provider: PROVIDER_ID,
        providerId: SUBJECT,
      });
    }

    it('creates an account and provider link through one policy call for the attempt client', async () => {
      const attempt = await startLifecycleAttempt(e2e, 'signIn');

      const verified = await verify(attempt);

      expect(verified.status).toBe(201);
      expect(parseLifecycleResult(verified)).toMatchObject({
        stage: 'consentRequired',
        account: { email: EMAIL },
      });
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: NATIVE_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.PROVIDER,
      });
      expect(policy.calls[0].unitOfWork).toBeInstanceOf(UnitOfWork);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
      const accountId = await e2e.state.accounts.accountIdFor(EMAIL);
      expect(await linkedAccount()).toMatchObject({ id: accountId });
    });

    it('refuses before storing an account or link and leaves the attempt unadvanced', async () => {
      const attempt = await startLifecycleAttempt(e2e, 'signIn');
      const before = await storedAttempt(e2e, attempt);
      policy.refused = true;

      const refused = await verify(attempt);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
      expect(policy.calls).toHaveLength(1);
      expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
      expect(await linkedAccount()).toBeNull();
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      const after = await storedAttempt(e2e, attempt);
      expect(after.phase).toBe(before.phase);
      expect(after.details).toEqual(before.details);
      expect(after.activeOperationId).toBeNull();
    });

    it.each(['address', 'identity'] as const)(
      'signs in an existing %s match without asking a refusing policy',
      async (match) => {
        const account = await e2e.state.accounts.createAccount({
          email: EMAIL,
          name: 'Existing provider account',
          isVerified: true,
        });
        if (match === 'identity') {
          await e2e.app
            .get(AccountLinkingService)
            .linkProvider(account._id, PROVIDER_ID, {
              providerId: SUBJECT,
              email: EMAIL,
              emailVerified: true,
              name: 'Existing provider account',
            });
        }
        policy.refused = true;
        const attempt = await startLifecycleAttempt(e2e, 'signIn');

        const verified = await verify(attempt);

        expect(verified.status).toBe(201);
        expect(parseLifecycleResult(verified)).toMatchObject({
          stage: 'consentRequired',
          account: { id: account._id },
        });
        expect(policy.calls).toEqual([]);
        expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
        expect(await linkedAccount()).toMatchObject({ id: account._id });
      },
    );
  });
}
// feature:google:end
// feature:oauth-core:end
