import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { SignInService } from './sign-in.service';
import { Sessions } from '../../services/sessions/sessions';
import { WEB_CLIENT_ID } from '../../../session/constants/client-ids';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import { MongoRolePermissions } from '../../../role/persistence/mongo/mongo-role-permissions';
import { SessionCookieService } from '../../services/sessions/session-cookie.service';
import { AuthFeaturesService } from '../../services/features/auth-features.service'; // feature:totp
import { TwoFactorChallengeService } from '../../two-factor/services/two-factor-challenge.service'; // feature:totp
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import { AuthProvider } from '../../../user/enums/auth-provider.enum';
import {
  createModelMock,
  createResponseMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';

const USER_ID = '507f1f77bcf86cd799439011';

const MOCK_RESPONSE = createResponseMock({
  req: { headers: { 'user-agent': 'test-agent' }, ip: '127.0.0.1' },
  setHeader: jest.fn(),
});

interface Harness {
  service: SignInService;
  roleModel: { findOne: jest.Mock };
  sessionService: { createSession: jest.Mock };
  sessionCookieService: { set: jest.Mock };
  challengeService: { issue: jest.Mock }; // feature:totp
}

function createHarness(): Harness {
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
  const sessionService = partialMock<Sessions>({
    createSession,
    assertAdmission: () => Promise.resolve(),
  });
  const configService = new ConfigService({
    'twoFactor.enabled': true, // feature:totp
  });
  const browserApplications = browserApplicationsForTest(configService);
  const set = jest.fn();
  const sessionCookieService = new SessionCookieService(
    configService,
    browserApplications,
  );
  jest.spyOn(sessionCookieService, 'set').mockImplementation(set);
  // feature:totp:start
  const authFeatures = new AuthFeaturesService(
    configService,
    browserApplications,
  );
  const issue = jest.fn().mockResolvedValue(undefined);
  const challengeService = partialMock<TwoFactorChallengeService>({ issue });

  // feature:totp:end

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
        authFeatures, // feature:totp
        challengeService, // feature:totp
        browserApplications,
      ),
    ),
    roleModel,
    sessionService: { createSession },
    sessionCookieService: { set },
    challengeService: { issue }, // feature:totp
  };
}

function plainUser(): UserDocument {
  const draft = {
    _id: new Types.ObjectId(USER_ID),
    email: 'user@example.com',
    name: 'Test User',
    role: 'user',
    permissions: [],
    authProvider: AuthProvider.EMAIL,
    isVerified: true,
    isDeleted: false,
    twoFactor: {
      enabled: false,
      secret: null,
      confirmedAt: null,
      recoveryCodes: [],
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
    },
  };
  return partialMock<UserDocument>(draft);
}

describe('SignInService', () => {
  describe('completeSignIn', () => {
    it('should create the session for an account without a second factor', async () => {
      const harness = createHarness();

      const outcome = await harness.service.completeSignIn(
        plainUser(),
        MOCK_RESPONSE,
        'password',
      );

      expect(outcome).toEqual({
        requiresTwoFactor: false,
        user: expect.objectContaining({
          email: 'user@example.com',
          permissions: ['read'],
        }) as unknown,
      });
      expect(harness.sessionService.createSession).toHaveBeenCalledWith(
        USER_ID,
        'test-agent',
        '127.0.0.1',
        WEB_CLIENT_ID,
        { authenticationMethods: ['password'], userVerified: false },
      );
      expect(harness.sessionCookieService.set).toHaveBeenCalledWith(
        MOCK_RESPONSE,
        'session-token-123',
        WEB_CLIENT_ID,
      );
      expect(harness.challengeService.issue).not.toHaveBeenCalled(); // feature:totp
    });
  });

  describe('issueSession', () => {
    it('should create the session and set its cookie', async () => {
      const harness = createHarness();

      const summary = await harness.service.issueSession(
        plainUser(),
        MOCK_RESPONSE,
      );

      expect(summary.email).toBe('user@example.com');
      expect(harness.sessionCookieService.set).toHaveBeenCalled();
    });

    it('should not create a session or set a cookie when the role lookup fails', async () => {
      const harness = createHarness();
      harness.roleModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('role read failed')),
      });

      await expect(
        harness.service.issueSession(plainUser(), MOCK_RESPONSE),
      ).rejects.toThrow('role read failed');

      expect(harness.sessionService.createSession).not.toHaveBeenCalled();
      expect(harness.sessionCookieService.set).not.toHaveBeenCalled();
    });

    it('should not set a cookie when session creation fails', async () => {
      const harness = createHarness();
      harness.sessionService.createSession.mockRejectedValueOnce(
        new Error('issuance failed'),
      );

      await expect(
        harness.service.issueSession(plainUser(), MOCK_RESPONSE),
      ).rejects.toThrow('issuance failed');

      expect(harness.sessionCookieService.set).not.toHaveBeenCalled();
    });
  });
});
