import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { OAuthService } from '../../oauth.service';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { Sessions } from '../../../services/sessions/sessions';
import { SessionCookieService } from '../../../services/sessions/session-cookie.service';
import { ProfileSyncService } from '../../../../user/services/profile-sync.service';
import { AccountLinkingService } from '../../../../user/services/account-linking.service';
import { User } from '../../../../user/persistence/mongo/schemas/user.schema';
import { AppException } from '../../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { OAuthProviderStrategy } from '../../oauth-provider.interface';
import type { OAuthLinkParams } from '../../types/oauth-service.types';
import { MONGO_PROVIDER_SIGN_IN_STORE } from './mongo-provider-sign-in.store';
import { Role } from '../../../../role/persistence/mongo/schemas/role.schema';
import { Passkey } from '../../../../auth/passkeys/persistence/mongo/schemas/passkey.schema'; // feature:passkeys
import { MONGO_ACCOUNT_PROFILE_STORE } from '../../../../user/persistence/mongo/mongo-account-stores';
import { MailDispatcherService } from '../../../../mail/mail-dispatcher.service';
import {
  securityNoticeProviders,
  stubSmtpBoundary,
} from '../../../../../test/utils/security-notice-fixture';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const PROFILE = {
  providerId: 'google-42',
  email: 'user@example.com',
  emailVerified: true,
  name: 'Ada',
};

function strategy(): OAuthProviderStrategy {
  return {
    id: 'google',
    displayName: 'Google',
    envPrefix: 'GOOGLE',
    supportsPkce: true,
    usesOidc: true,
    emailAlwaysVerified: true,
    autoLinksByEmail: true,
    callbackMethod: 'GET',
    isEnabled: () => true,
    getAuthorizationUrl: () => 'https://example.test',
    exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'token' }),
    fetchProfile: jest.fn().mockResolvedValue(PROFILE),
  };
}

describe('OAuthService linking', () => {
  let service: OAuthService;
  let accountLinking: { linkProvider: jest.Mock };
  let profileSync: { syncProfileFromProvider: jest.Mock };
  let signIn: { completeSignIn: jest.Mock };
  let sessions: { validateSession: jest.Mock; getUserSessions: jest.Mock };
  let cookies: { read: jest.Mock };
  let module: TestingModule | undefined;
  let restoreSmtp: (() => void) | undefined;

  beforeEach(async () => {
    restoreSmtp = stubSmtpBoundary();
    accountLinking = {
      linkProvider: jest.fn().mockResolvedValue({ id: USER_ID }),
    };
    profileSync = {
      syncProfileFromProvider: jest.fn().mockResolvedValue(undefined),
    };
    signIn = { completeSignIn: jest.fn() };
    sessions = {
      validateSession: jest.fn().mockResolvedValue({
        id: SESSION_ID,
        user: { id: USER_ID, isDeleted: false },
      }),
      // The live sessions of the account that started the link, and of no other.
      getUserSessions: jest.fn((userId: string) =>
        Promise.resolve(userId === USER_ID ? [{ id: SESSION_ID }] : []),
      ),
    };
    cookies = { read: jest.fn().mockReturnValue('session-token') };
    const config = new ConfigService({
      smtp: { from: 'security-notice@example.test' },
      mail: { maxPendingSends: 4, drainDeadlineMs: 250 },
    });
    const userModel = {
      findOne: jest.fn(),
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
    };
    const roleModel = { findOne: jest.fn() };

    module = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Role.name), useValue: roleModel },
        { provide: getModelToken(Passkey.name), useValue: {} }, // feature:passkeys
        MONGO_ACCOUNT_PROFILE_STORE,
        MONGO_PROVIDER_SIGN_IN_STORE,
        { provide: SignInCompletion, useValue: signIn },
        { provide: ProfileSyncService, useValue: profileSync },
        { provide: AccountLinkingService, useValue: accountLinking },
        { provide: Sessions, useValue: sessions },
        { provide: SessionCookieService, useValue: cookies },
        ...securityNoticeProviders(config),
      ],
    }).compile();

    service = module.get(OAuthService);
  });

  afterEach(async () => {
    try {
      await module?.get(MailDispatcherService).flush();
      await module?.close();
    } finally {
      restoreSmtp?.();
    }
  });

  function params(
    overrides: { linkUserId?: string; linkSessionId?: string } = {},
  ): OAuthLinkParams {
    return {
      strategy: strategy(),
      code: 'auth-code',
      redirectUri: 'https://api.example.com/callback',
      response: {} as Response,
      linkUserId: overrides.linkUserId ?? USER_ID,
      linkSessionId: overrides.linkSessionId ?? SESSION_ID,
      locale: 'en',
    };
  }

  async function refusalOf(attempt: Promise<unknown>): Promise<unknown> {
    try {
      await attempt;
    } catch (error) {
      return error instanceof AppException
        ? { code: error.getCode(), status: error.getStatus() }
        : error;
    }
    throw new Error('expected a rejection');
  }

  it('links the provider to the account in the state without the session cookie and without issuing a session', async () => {
    cookies.read.mockReturnValue(undefined);

    await service.link(params());

    expect(accountLinking.linkProvider).toHaveBeenCalledWith(
      USER_ID,
      'google',
      PROFILE,
    );
    expect(profileSync.syncProfileFromProvider).toHaveBeenCalledWith(
      USER_ID,
      'google',
      PROFILE,
    );
    expect(signIn.completeSignIn).not.toHaveBeenCalled();
  });

  it('answers the start with the account and the session that asked', async () => {
    expect(await service.requireSession({} as Request)).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('rejects a logged-out start', async () => {
    cookies.read.mockReturnValue(undefined);

    await expect(
      service.requireSessionUserId({} as Request),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_REQUIRED,
    });
  });

  it('refuses a link start carrying both a cookie and a bearer token', async () => {
    await expect(
      service.requireSessionUserId({
        headers: { authorization: 'Bearer access-token' },
      } as Request),
    ).rejects.toMatchObject({
      code: ErrorCode.MIXED_CREDENTIALS,
    });
    expect(sessions.validateSession).not.toHaveBeenCalled();
  });

  it.each([
    ['the session that asked was ended', { linkSessionId: 'session-ended' }],
    ['the session belongs to another account', { linkUserId: 'other-user' }],
    ['the account has no live session left', { linkUserId: 'gone-user' }],
  ])('refuses the link when %s, before the code is spent', async (_, state) => {
    const linking = params(state);

    expect({
      refusal: await refusalOf(service.link(linking)),
      exchanged: (linking.strategy.exchangeCode as jest.Mock).mock.calls.length,
      linked: accountLinking.linkProvider.mock.calls.length,
    }).toEqual({
      refusal: { code: 'SESSION_INVALID', status: 401 },
      exchanged: 0,
      linked: 0,
    });
  });

  it('surfaces a provider identity that already belongs to another user', async () => {
    accountLinking.linkProvider.mockRejectedValue(
      new AppException(
        ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
        'already linked',
        HttpStatus.CONFLICT,
        { provider: 'google' },
      ),
    );

    await expect(service.link(params())).rejects.toMatchObject({
      code: ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
    });
    expect(signIn.completeSignIn).not.toHaveBeenCalled();
  });
});
