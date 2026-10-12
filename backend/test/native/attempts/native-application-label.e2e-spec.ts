import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { parseNativeApplications } from '../../../src/config/utils/native-application-config.util';
import { ApplicationRegistry } from '../../../src/session/applications/application-registry';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native label client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { password: true },
};
const LABEL_CASES = [
  {
    label: '161 letters',
    configured: 'n'.repeat(161),
    expected: 'n'.repeat(160),
  },
  {
    label: '160 letters',
    configured: 'n'.repeat(160),
    expected: 'n'.repeat(160),
  },
  {
    label: '80 supplementary letters',
    configured: '\u{10400}'.repeat(80),
    expected: '\u{10400}'.repeat(80),
  },
  {
    label: '81 supplementary letters',
    configured: '\u{10400}'.repeat(81),
    expected: '\u{10400}'.repeat(80),
  },
  {
    label: 'a supplementary letter crossing the boundary',
    configured: `${'n'.repeat(159)}\u{10400}z`,
    expected: 'n'.repeat(159),
  },
  {
    label: 'normalization before the boundary',
    configured: `${'n'.repeat(159)}E\u0301z`,
    expected: `${'n'.repeat(159)}É`,
  },
  {
    label: 'trailing whitespace after truncation',
    configured: `${'n'.repeat(159)} z`,
    expected: 'n'.repeat(159),
  },
];

describe('native application label projection (e2e)', () => {
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

  it.each(LABEL_CASES)(
    'returns SDK-readable consent and resume for $label without rewriting configuration or storage',
    async ({ configured, expected }) => {
      const applications = parseNativeApplications(
        JSON.stringify([{ ...APPLICATION, displayName: configured }]),
        { allowCustomScheme: true },
      );
      const config = e2e.app.get(ConfigService);
      const registry = e2e.app.get(ApplicationRegistry);
      config.set('auth.nativeApplications', applications);
      await registry.reconcileNativeApplications();
      expect((await registry.lookUpClient(NATIVE_CLIENT_ID))?.displayName).toBe(
        configured,
      );

      const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
      const started = await request(e2e.httpServer)
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
      const attempt = unwrapNativeAttemptStart(started);
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
            application: { clientId: NATIVE_CLIENT_ID, displayName: expected },
          },
        });
        const parsed = unwrapNativeAttemptResult(response);
        expect(parsed.stage).toBe('consentRequired');
        if (parsed.stage !== 'consentRequired')
          throw new Error('consent missing');
        expect(parsed.application.displayName).toBe(expected);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      expect(config.get('auth.nativeApplications')).toEqual(applications);
      expect((await registry.lookUpClient(NATIVE_CLIENT_ID))?.displayName).toBe(
        configured,
      );
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await e2e.state.native.credentialCount()).toBe(0);
    },
  );
});
