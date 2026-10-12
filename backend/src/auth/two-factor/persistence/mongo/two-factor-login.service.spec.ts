// The verification service reaches the otplib adapter; the delta is driven
// from here instead.
jest.mock('../../utils/totp.util', () => ({
  generateTotpSecret: jest.fn(),
  buildOtpauthUrl: jest.fn(),
  checkTotpDelta: jest.fn(),
}));

import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppException } from '../../../../common/exceptions/app.exception';
import { TwoFactorLoginService } from '../../two-factor-login.service';
import { VerifyTwoFactorDto } from '../../dto/verify-two-factor.dto';
import { TwoFactorChallengeService } from '../../services/two-factor-challenge.service';
import { TwoFactorVerificationService } from '../../services/two-factor-verification.service';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import { MongoSecondFactorSignIn } from './mongo-second-factor-sign-in';
import {
  MongoSecondFactorStore,
  secondFactorDocumentOf,
} from './mongo-second-factor.store';
import { SecondFactorVerifier } from '../../services/second-factor-verifiers';
import { checkTotpDelta } from '../../utils/totp.util';
import {
  createCrypto,
  createEnabledUser,
  MockUser,
  RECOVERY_CODE,
  USER_ID,
} from './two-factor.harness-spec';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import {
  createModelMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';
import {
  createRequestMock,
  createResponseMock,
} from '../../../../common/testing/test-doubles.harness-spec';

const delta = checkTotpDelta as jest.Mock;

const CHALLENGE_ID = new Types.ObjectId('507f1f77bcf86cd799439012');
const MOCK_REQUEST = createRequestMock({ cookies: {} });
const MOCK_RESPONSE = createResponseMock({
  req: { headers: { 'user-agent': 'test-agent' }, ip: '127.0.0.1' },
});

const USER_SUMMARY = {
  id: USER_ID.toString(),
  email: 'user@example.com',
  name: 'Test User',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: ['read'],
};

/** Stands in for the credential a feature such as passkeys would carry. */
const CREDENTIAL = Object.assign(new VerifyTwoFactorDto(), {
  credential: 'signed-blob',
});

interface Harness {
  service: TwoFactorLoginService;
  challengeService: {
    read: jest.Mock;
    claim: jest.Mock;
    registerFailure: jest.Mock;
    consume: jest.Mock;
    clear: jest.Mock;
  };
  signInService: { issueSession: jest.Mock };
  verifier: { supports: jest.Mock; verify: jest.Mock };
}

function createHarness(user: MockUser | null): Harness {
  const userModel = {
    findById: jest.fn().mockResolvedValue(user),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };

  const challengeService = {
    read: jest
      .fn()
      .mockResolvedValue({ challengeId: CHALLENGE_ID, userId: USER_ID }),
    claim: jest
      .fn()
      .mockResolvedValue({ challengeId: CHALLENGE_ID, userId: USER_ID }),
    registerFailure: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
  };

  const signInService = {
    issueSession: jest.fn().mockResolvedValue(USER_SUMMARY),
  };

  // One registered verifier, answering for the payloads that carry a
  // credential instead of a code.
  const verifier = {
    supports: jest.fn((dto: Record<string, unknown>) => 'credential' in dto),
    verify: jest.fn().mockResolvedValue(undefined),
  };

  const accounts = new MongoSecondFactorStore(
    createModelMock<ConstructorParameters<typeof MongoSecondFactorStore>[0]>(
      userModel,
    ),
  );
  // The double is handed the document behind the account, which is what the
  // cases compare against.
  const verifierOnDocuments: SecondFactorVerifier = {
    supports: (dto) => verifier.supports({ ...dto }),
    verify: async (dto, account, request, response) => {
      await verifier.verify(
        dto,
        secondFactorDocumentOf(account),
        request,
        response,
      );
    },
  };

  return {
    service: new TwoFactorLoginService(
      accounts,
      partialMock<TwoFactorChallengeService>(challengeService),
      new TwoFactorVerificationService(accounts, createCrypto()),
      new MongoSecondFactorSignIn(partialMock<SignInService>(signInService)),
      [verifierOnDocuments],
    ),
    challengeService,
    signInService,
    verifier,
  };
}

describe('TwoFactorLoginService', () => {
  beforeEach(() => {
    delta.mockReset();
  });

  it('should finish the sign-in and clear the challenge on a valid code', async () => {
    const user = createEnabledUser(createCrypto());
    const harness = createHarness(user);
    delta.mockReturnValue(0);

    const result = await harness.service.verify(
      { code: '123456' },
      MOCK_REQUEST,
      MOCK_RESPONSE,
    );

    expect(result.data).toEqual({
      requiresTwoFactor: false,
      user: USER_SUMMARY,
    });
    expect(harness.challengeService.consume).toHaveBeenCalledWith(CHALLENGE_ID);
    expect(harness.challengeService.clear).toHaveBeenCalledWith(MOCK_RESPONSE);
    expect(harness.signInService.issueSession).toHaveBeenCalledWith(
      user,
      MOCK_RESPONSE,
    );
  });

  it('should finish the sign-in on a recovery code and spend it', async () => {
    const user = createEnabledUser(createCrypto());
    const harness = createHarness(user);

    await harness.service.verify(
      { recoveryCode: RECOVERY_CODE },
      MOCK_REQUEST,
      MOCK_RESPONSE,
    );

    expect(user.twoFactor.recoveryCodes[0].usedAt).toEqual(expect.any(Date));
    expect(harness.signInService.issueSession).toHaveBeenCalled();
  });

  it('should count a wrong code against the challenge and keep it open', async () => {
    const harness = createHarness(createEnabledUser(createCrypto()));
    delta.mockReturnValue(null);

    await expect(
      harness.service.verify({ code: '000000' }, MOCK_REQUEST, MOCK_RESPONSE),
    ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });

    expect(harness.challengeService.registerFailure).toHaveBeenCalledWith(
      CHALLENGE_ID,
    );
    expect(harness.challengeService.consume).not.toHaveBeenCalled();
    expect(harness.signInService.issueSession).not.toHaveBeenCalled();
  });

  it('should hand a credential to the verifier that claims it', async () => {
    const user = createEnabledUser(createCrypto());
    const harness = createHarness(user);

    const result = await harness.service.verify(
      CREDENTIAL,
      MOCK_REQUEST,
      MOCK_RESPONSE,
    );

    expect(result.data).toEqual({
      requiresTwoFactor: false,
      user: USER_SUMMARY,
    });
    expect(harness.verifier.verify).toHaveBeenCalledWith(
      CREDENTIAL,
      user,
      MOCK_REQUEST,
      MOCK_RESPONSE,
    );
    expect(harness.challengeService.consume).toHaveBeenCalledWith(CHALLENGE_ID);
  });

  it('should count a rejected credential against the challenge', async () => {
    const harness = createHarness(createEnabledUser(createCrypto()));
    harness.verifier.verify.mockRejectedValue(
      new AppException(
        ErrorCode.PASSKEY_VERIFICATION_FAILED,
        'refused',
        HttpStatus.UNAUTHORIZED,
      ),
    );

    await expect(
      harness.service.verify(CREDENTIAL, MOCK_REQUEST, MOCK_RESPONSE),
    ).rejects.toMatchObject({
      code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
      status: 401,
    });

    expect(harness.challengeService.registerFailure).toHaveBeenCalledWith(
      CHALLENGE_ID,
    );
    expect(harness.signInService.issueSession).not.toHaveBeenCalled();
  });

  it('should read a code itself when no verifier claims the payload', async () => {
    const harness = createHarness(createEnabledUser(createCrypto()));
    delta.mockReturnValue(0);

    await harness.service.verify(
      { code: '123456' },
      MOCK_REQUEST,
      MOCK_RESPONSE,
    );

    expect(harness.verifier.verify).not.toHaveBeenCalled();
    expect(harness.signInService.issueSession).toHaveBeenCalled();
  });

  it('should refuse a challenge whose account is gone', async () => {
    const harness = createHarness(null);

    await expect(
      harness.service.verify({ code: '123456' }, MOCK_REQUEST, MOCK_RESPONSE),
    ).rejects.toMatchObject({
      code: ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
      status: 401,
    });
    expect(harness.challengeService.consume).toHaveBeenCalledWith(CHALLENGE_ID);
    expect(harness.challengeService.clear).toHaveBeenCalledWith(MOCK_RESPONSE);
  });

  it('should refuse a challenge for an account that turned the factor off', async () => {
    const user = createEnabledUser(createCrypto());
    user.twoFactor.enabled = false;

    await expect(
      createHarness(user).service.verify(
        { code: '123456' },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CHALLENGE_INVALID });
  });

  it('should pass on the rejection when there is no usable challenge', async () => {
    const harness = createHarness(createEnabledUser(createCrypto()));
    harness.challengeService.claim.mockRejectedValue(
      new Error('challenge is unknown'),
    );

    await expect(
      harness.service.verify({ code: '123456' }, MOCK_REQUEST, MOCK_RESPONSE),
    ).rejects.toThrow('challenge is unknown');
    expect(harness.signInService.issueSession).not.toHaveBeenCalled();
  });
});
