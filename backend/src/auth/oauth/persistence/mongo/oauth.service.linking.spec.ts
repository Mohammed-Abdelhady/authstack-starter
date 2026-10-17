import { IssuanceApplications } from '../../../../session/issuance/issuance-applications';
import { browserApplicationsForTest } from '../../../../common/testing/browser-applications.harness-spec';
import { WEB_CLIENT_ID } from '../../../../session/constants/client-ids';
import { ConfigService } from '@nestjs/config';
import { OAuthProviderStrategy } from '../../oauth-provider.interface';
import { OAuthLinkParams } from '../../types/oauth-service.types';
import { AccountLinkingService } from '../../../../user/services/account-linking.service';
import { ProfileSyncService } from '../../../../user/services/profile-sync.service';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { Sessions } from '../../../services/sessions/sessions';
import { SessionCookieService } from '../../../services/sessions/session-cookie.service';
import { AccountCreationPolicy } from '../../../services/registration/account-creation-policy';
// feature:totp:start
import { AuthFeaturesService } from '../../../services/features/auth-features.service';
import { TwoFactorChallengeService } from '../../../two-factor/services/two-factor-challenge.service';
import { TotpSecretCryptoService } from '../../../two-factor/services/totp-secret-crypto.service';
import { MongoSecondFactorChallengeStore } from '../../../two-factor/persistence/mongo/mongo-second-factor-challenge.store';
import {
  TwoFactorChallenge,
  TwoFactorChallengeDocument,
  TwoFactorChallengeSchema,
} from '../../../two-factor/persistence/mongo/schemas/two-factor-challenge.schema';
// feature:totp:end
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import {
  createRequestMock,
  createResponseMock,
} from '../../../../common/testing/test-doubles.harness-spec';
import { bootMongoLinkedAccountsHarness } from '../../../../user/persistence/mongo/linked-accounts-contract/mongo-linked-accounts.harness-spec';
import { linkedServicesOn } from '../../../../user/linked-accounts-contract/linked-accounts-contract.harness-spec';
import { hashToken } from '../../../../session/utils/hashing/token-hash';
import { rerunAtOnce } from '../../../../../test/utils/session/issuance-contract/issuance-contract-support';
import { refusalOf } from '../../../../../test/utils/user/accounts-contract/accounts-contract-support';
import { TEST_NOW } from '../../../../../test/utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/hook-timeouts';
import { OAuthService } from '../../oauth.service';

const PROVIDER = 'google';
const PROFILE = {
  providerId: 'google-42',
  email: 'user@example.com',
  emailVerified: true,
  name: 'Ada',
};

async function createOAuthLinkingFixture(
  harness: Awaited<ReturnType<typeof bootMongoLinkedAccountsHarness>>,
) {
  await harness.seedRole({
    name: 'User',
    slug: 'user',
    level: 1,
    permissions: [],
  });
  const userId = await harness.seedAccount({
    email: PROFILE.email,
    name: 'Before linking',
    role: 'user',
  });
  const otherId = await harness.seedAccount({
    email: 'other@example.test',
    role: 'user',
  });
  const sessions = harness.booted.app.get(Sessions);
  const issued = await sessions.createSession(
    userId,
    'oauth-linking-contract',
    '127.0.0.1',
    WEB_CLIENT_ID,
  );
  const storedSession = await harness.booted.sessions
    .findOne({ tokenHash: hashToken(issued.sessionToken) })
    .orFail()
    .lean()
    .exec();
  const config = new ConfigService({ session: { cookieName: 'link-session' } });
  const browserApplications = browserApplicationsForTest(config);
  const cookies = new SessionCookieService(config, browserApplications);
  // feature:totp:start
  const authFeatures = new AuthFeaturesService(config, browserApplications);
  const connection = harness.booted.connection;
  connection.model(TwoFactorChallenge.name, TwoFactorChallengeSchema);
  const challenges = connection.model<TwoFactorChallengeDocument>(
    TwoFactorChallenge.name,
  );
  await challenges.init();
  await challenges.deleteMany({});
  const challengeService = new TwoFactorChallengeService(
    new MongoSecondFactorChallengeStore(challenges),
    config,
    new TotpSecretCryptoService(config),
    browserApplications,
  );
  // feature:totp:end
  const signIn = new SignInCompletion(
    harness.rolePermissions,
    sessions,
    cookies,
    authFeatures, // feature:totp
    challengeService, // feature:totp
    browserApplications,
  );
  const { linking, sync } = linkedServicesOn(harness);
  return {
    userId,
    otherId,
    sessionId: storedSession._id.toString(),
    sessions,
    linking,
    sync,
    signIn,
    request: createRequestMock({
      cookies: { [cookies.name]: issued.sessionToken },
      headers: {},
    }),
    service: new OAuthService(
      harness.providerSignIn,
      signIn,
      sync,
      linking,
      sessions,
      cookies,
      new AccountCreationPolicy(harness.booted.app.get(IssuanceApplications)),
      harness.ledger,
      harness.clock,
      harness.runner(rerunAtOnce),
    ),
  };
}

function strategy() {
  return {
    id: PROVIDER,
    displayName: 'Google',
    envPrefix: 'GOOGLE',
    supportsPkce: true,
    usesOidc: true,
    emailAlwaysVerified: true,
    autoLinksByEmail: true,
    callbackMethod: 'GET',
    isEnabled: () => true,
    getAuthorizationUrl: () => 'https://example.test',
    exchangeCode: jest
      .fn<
        ReturnType<OAuthProviderStrategy['exchangeCode']>,
        Parameters<OAuthProviderStrategy['exchangeCode']>
      >()
      .mockResolvedValue({ accessToken: 'token' }),
    fetchProfile: jest
      .fn<
        ReturnType<OAuthProviderStrategy['fetchProfile']>,
        Parameters<OAuthProviderStrategy['fetchProfile']>
      >()
      .mockResolvedValue(PROFILE),
  } satisfies OAuthProviderStrategy;
}

describe('OAuthService linking', () => {
  let harness:
    Awaited<ReturnType<typeof bootMongoLinkedAccountsHarness>> | undefined;
  let fixture: Awaited<ReturnType<typeof createOAuthLinkingFixture>>;
  let linkProvider: jest.SpiedFunction<AccountLinkingService['linkProvider']>;
  let syncProfile: jest.SpiedFunction<
    ProfileSyncService['syncProfileFromProvider']
  >;
  let validateSession: jest.SpiedFunction<Sessions['validateSession']>;

  function current() {
    if (!harness) throw new Error('the Mongo linking harness did not start');
    return harness;
  }

  beforeAll(async () => {
    harness = await bootMongoLinkedAccountsHarness();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    const h = current();
    h.clock.set(TEST_NOW);
    await h.reset();
    fixture = await createOAuthLinkingFixture(h);
    linkProvider = jest.spyOn(fixture.linking, 'linkProvider');
    syncProfile = jest.spyOn(fixture.sync, 'syncProfileFromProvider');
    validateSession = jest.spyOn(fixture.sessions, 'validateSession');
  }, SESSION_AUTHORITY_RESET_TIMEOUT_MS);

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await harness?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  function params(overrides: { linkUserId?: string } = {}) {
    return {
      strategy: strategy(),
      code: 'auth-code',
      redirectUri: 'https://api.example.com/callback',
      response: createResponseMock({ req: fixture.request }),
      linkUserId: overrides.linkUserId ?? fixture.userId,
      linkSessionId: fixture.sessionId,
      locale: 'en',
    } satisfies OAuthLinkParams;
  }

  it('links the provider to the account in the state without the session cookie and without issuing a session', async () => {
    fixture.request.cookies = {};

    await fixture.service.link(params());

    expect(linkProvider).toHaveBeenCalledWith(
      fixture.userId,
      PROVIDER,
      PROFILE,
    );
    expect(syncProfile).toHaveBeenCalledWith(fixture.userId, PROVIDER, PROFILE);
    expect(await current().storedLinks(fixture.userId)).toEqual([
      { provider: 'google', providerId: 'google-42' },
    ]);
    expect(await current().syncFacts(fixture.userId)).toMatchObject({
      name: 'Ada',
      primaryProvider: 'google',
      lastSyncedProvider: 'google',
    });
    expect(await current().liveSessionIds(fixture.userId)).toEqual([
      fixture.sessionId,
    ]);
  });

  it('answers the start with the account and the session that asked', async () => {
    expect(await fixture.service.requireSession(fixture.request)).toEqual({
      userId: fixture.userId,
      sessionId: fixture.sessionId,
    });
  });

  it('rejects a logged-out start', async () => {
    fixture.request.cookies = {};

    await expect(
      fixture.service.requireSessionUserId(fixture.request),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_REQUIRED });
  });

  it('refuses a link start carrying both a cookie and a bearer token', async () => {
    fixture.request.headers.authorization = 'Bearer access-token';

    await expect(
      fixture.service.requireSessionUserId(fixture.request),
    ).rejects.toMatchObject({ code: ErrorCode.MIXED_CREDENTIALS });
    expect(validateSession).not.toHaveBeenCalled();
  });

  it.each([
    ['the session that asked was ended', 'ended'],
    ['the session belongs to another account', 'other-account'],
    ['the account has no live session left', 'no-sessions'],
  ] as const)(
    'refuses the link when %s, before the code is spent',
    async (_, state) => {
      const h = current();
      if (state === 'ended') {
        await fixture.sessions.invalidateSessionById(
          fixture.sessionId,
          fixture.userId,
        );
        await h.seedSession(fixture.userId);
      } else if (state === 'other-account') {
        await h.seedSession(fixture.otherId);
      } else {
        await fixture.sessions.invalidateAllSessions(fixture.userId);
      }
      const linking = params({
        linkUserId:
          state === 'other-account' ? fixture.otherId : fixture.userId,
      });

      expect({
        refusal: await refusalOf(fixture.service.link(linking)),
        exchanged: linking.strategy.exchangeCode.mock.calls.length,
        linked: linkProvider.mock.calls.length,
      }).toEqual({
        refusal: { code: 'SESSION_INVALID', status: 401 },
        exchanged: 0,
        linked: 0,
      });
      expect(await h.storedLinks(fixture.userId)).toEqual([]);
      expect(await h.storedLinks(fixture.otherId)).toEqual([]);
    },
  );

  it('surfaces a provider identity that already belongs to another user', async () => {
    const h = current();
    const other = await h.links.findAccount(fixture.otherId);
    if (!other) throw new Error('the other account is missing');
    await h.links.addLink(other, {
      provider: PROVIDER,
      providerId: PROFILE.providerId,
    });

    await expect(fixture.service.link(params())).rejects.toMatchObject({
      code: ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
    });
    expect(await h.storedLinks(fixture.userId)).toEqual([]);
    expect(await h.storedLinks(fixture.otherId)).toEqual([
      { provider: 'google', providerId: 'google-42' },
    ]);
  });
});
