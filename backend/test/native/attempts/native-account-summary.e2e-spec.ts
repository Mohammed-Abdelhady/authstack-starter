import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { GENERIC_OIDC_PROVIDER } from '../../../src/common/constants/oauth-providers';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { ProfileSyncService } from '../../../src/user/services/profile-sync.service';
import { LinkedAccountStore } from '../../../src/user/stores/linked-account.store';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native summary test client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { password: true },
};
interface DisplayNameCase {
  label: string;
  storedName: string;
  displayName: string;
  providerName?: string;
}

const NAME_CASES: DisplayNameCase[] = [
  {
    label: 'an existing 101-letter provider name',
    storedName: 'n'.repeat(101),
    displayName: 'n'.repeat(100),
  },
  {
    label: '100 supplementary letters',
    storedName: '\u{10400}'.repeat(100),
    displayName: '\u{10400}'.repeat(100),
  },
  {
    label: '101 supplementary letters',
    storedName: '\u{10400}'.repeat(101),
    displayName: '\u{10400}'.repeat(100),
  },
  {
    label: 'normalization before the character boundary',
    storedName: `${'\u{10400}'.repeat(99)}E\u0301z`,
    displayName: `${'\u{10400}'.repeat(99)}É`,
  },
  {
    label: 'a provider name with surrounding whitespace',
    storedName: 'E\u0301mile',
    providerName: ' \tE\u0301mile\n ',
    displayName: 'Émile',
  },
];
const POSTGRES_NAME_CASES =
  process.env.DATABASE_TYPE === 'postgres'
    ? [
        {
          label: 'a legacy blank name',
          storedName: '',
          providerName: ' \t ',
          displayName: SEED_USER.email,
        },
      ]
    : [];

describe('native account summary projection (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [APPLICATION],
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function syncProviderName(name: string): Promise<string> {
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('seed account missing');
    const links = e2e.app.get(LinkedAccountStore);
    const account = await links.findSyncTarget(userId);
    if (!account) throw new Error('profile sync target missing');
    await links.savePrimaryProvider(account, GENERIC_OIDC_PROVIDER);
    await e2e.app
      .get(ProfileSyncService)
      .syncProfileFromProvider(userId, GENERIC_OIDC_PROVIDER, {
        providerId: 'native-summary-subject',
        email: SEED_USER.email,
        emailVerified: true,
        name,
      });
    return userId;
  }

  async function start() {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const response = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId: NATIVE_CLIENT_ID,
        redirectUri: NATIVE_REDIRECT,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'signIn',
      })
      .expect(201);
    return unwrapNativeAttemptStart(response);
  }

  it.each([...NAME_CASES, ...POSTGRES_NAME_CASES])(
    'returns SDK-readable consent and resume for $label without changing storage or issuing a session',
    async ({ storedName, displayName, ...input }) => {
      const userId = await syncProviderName(input.providerName ?? storedName);
      const storedBefore = await e2e.state.accounts.accountWithId(userId);
      expect(storedBefore?.name).toBe(storedName);
      const attempt = await start();
      const consent = await request(e2e.httpServer)
        .post(`/api/auth/native/attempts/${attempt.attemptId}/password`)
        .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
        .send({ email: SEED_USER.email, password: SEED_USER.password })
        .expect(201);
      const resumed = await request(e2e.httpServer)
        .get(`/api/auth/native/attempts/${attempt.attemptId}`)
        .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
        .expect(200);

      for (const response of [consent, resumed]) {
        expect(response.body).toMatchObject({
          data: {
            account: { id: userId, email: SEED_USER.email, name: displayName },
          },
        });
        const parsed = unwrapNativeAttemptResult(response);
        expect(parsed.stage).toBe('consentRequired');
        if (parsed.stage !== 'consentRequired')
          throw new Error('consent missing');
        expect(parsed.account).toEqual({
          id: userId,
          email: SEED_USER.email,
          name: displayName,
        });
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      expect((await e2e.state.accounts.accountWithId(userId))?.name).toBe(
        storedName,
      );
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await e2e.state.native.credentialCount()).toBe(0);
    },
  );
});
