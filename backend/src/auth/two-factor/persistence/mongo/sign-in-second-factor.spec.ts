import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import { Sessions } from '../../../services/sessions/sessions';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { MongoRolePermissions } from '../../../../role/persistence/mongo/mongo-role-permissions';
import { SessionCookieService } from '../../../services/sessions/session-cookie.service';
import { AuthFeaturesService } from '../../../services/features/auth-features.service';
import { TwoFactorChallengeService } from '../../services/two-factor-challenge.service';
import { UserDocument } from '../../../../user/persistence/mongo/schemas/user.schema';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import {
  createModelMock,
  createResponseMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';

/**
 * What the shared sign-in path does for an account that owes a code. The rest
 * of SignInService is covered next to the service itself.
 */

const USER_ID = '507f1f77bcf86cd799439011';

const MOCK_RESPONSE = createResponseMock({
  req: { headers: { 'user-agent': 'test-agent' }, ip: '127.0.0.1' },
  setHeader: jest.fn(),
});

interface Harness {
  service: SignInService;
  sessionService: { createSession: jest.Mock };
  sessionCookieService: { set: jest.Mock };
  challengeService: { issue: jest.Mock };
}

function createHarness(twoFactorFeatureOn = true): Harness {
  const roleModel = {
    findOne: jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue({ slug: 'user', permissions: ['read'] }),
    }),
  };

  const createSession = jest.fn().mockResolvedValue({
    sessionToken: 'session-token-123',
    csrfToken: 'csrf-token-123',
  });
  const sessionService = partialMock<Sessions>({ createSession });
  const set = jest.fn();
  const sessionCookieService = partialMock<SessionCookieService>({ set });
  const issue = jest.fn().mockResolvedValue(undefined);
  const challengeService = partialMock<TwoFactorChallengeService>({ issue });

  const configService = new ConfigService({
    'twoFactor.enabled': twoFactorFeatureOn,
  });

  return {
    service: new SignInService(
      new SignInCompletion(
        new MongoRolePermissions(
          createModelMock<
            ConstructorParameters<typeof MongoRolePermissions>[0]
          >(roleModel),
        ),
        sessionService,
        sessionCookieService,
        new AuthFeaturesService(configService),
        challengeService,
      ),
    ),
    sessionService: { createSession },
    sessionCookieService: { set },
    challengeService: { issue },
  };
}

function userWith(twoFactorEnabled: boolean): UserDocument {
  return partialMock<UserDocument>({
    _id: new Types.ObjectId(USER_ID),
    email: 'user@example.com',
    name: 'Test User',
    role: 'user',
    permissions: [],
    authProvider: AuthProvider.EMAIL,
    isVerified: true,
    isDeleted: false,
    twoFactor: {
      enabled: twoFactorEnabled,
      secret: null,
      confirmedAt: null,
      recoveryCodes: [],
      lastUsedStep: null,
    },
  });
}

describe('SignInService with a second factor', () => {
  it('should hold the session and open a challenge when a code is owed', async () => {
    const harness = createHarness();

    const outcome = await harness.service.completeSignIn(
      userWith(true),
      MOCK_RESPONSE,
      'magic_link',
    );

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(harness.challengeService.issue).toHaveBeenCalledWith(
      USER_ID,
      MOCK_RESPONSE,
      'magic_link',
    );
    expect(harness.sessionService.createSession).not.toHaveBeenCalled();
    expect(harness.sessionCookieService.set).not.toHaveBeenCalled();
  });

  it('should sign in directly when the deployment turned two-factor off', async () => {
    const harness = createHarness(false);

    const outcome = await harness.service.completeSignIn(
      userWith(true),
      MOCK_RESPONSE,
      'magic_link',
    );

    expect(outcome.requiresTwoFactor).toBe(false);
    expect(harness.challengeService.issue).not.toHaveBeenCalled();
    expect(harness.sessionService.createSession).toHaveBeenCalled();
  });

  it('should create the session even for an account that owes a code', async () => {
    const harness = createHarness();

    const summary = await harness.service.issueSession(
      userWith(true),
      MOCK_RESPONSE,
    );

    expect(summary.email).toBe('user@example.com');
    expect(harness.sessionCookieService.set).toHaveBeenCalled();
    expect(harness.challengeService.issue).not.toHaveBeenCalled();
  });
});
