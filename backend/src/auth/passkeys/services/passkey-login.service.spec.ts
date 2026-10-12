import { ErrorCode } from '../../../common/enums/error-code.enum';
import { SignInService } from '../../persistence/mongo/sign-in.service';
import { PasskeyAssertionService } from './passkey-assertion.service';
import { PasskeyLoginService } from './passkey-login.service';
import {
  MongoPasskeyAccounts,
  MongoPasskeySignIn,
} from '../persistence/mongo/mongo-passkey-accounts';
import {
  createModelMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import {
  CREDENTIAL_BODY,
  createMockPasskey,
  createMockRequest,
  createMockResponse,
  USER_ID,
} from '../persistence/mongo/passkeys.harness-spec';

const USER_SUMMARY = {
  id: USER_ID.toString(),
  email: 'user@example.com',
  name: 'Test User',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: ['read'],
};

interface Harness {
  service: PasskeyLoginService;
  assertions: { createOptions: jest.Mock; verify: jest.Mock };
  signInService: { issueSession: jest.Mock; completeSignIn: jest.Mock };
}

function createHarness(options: {
  userVerified?: boolean;
  owesSecondFactor?: boolean;
  user?: { _id: typeof USER_ID; email: string; isDeleted: boolean } | null;
}): Harness {
  const user =
    options.user === undefined
      ? { _id: USER_ID, email: 'user@example.com', isDeleted: false }
      : options.user;

  const userModel = { findById: jest.fn().mockResolvedValue(user) };

  const assertions = {
    createOptions: jest.fn().mockResolvedValue({ challenge: 'challenge' }),
    verify: jest.fn().mockResolvedValue({
      passkey: createMockPasskey(),
      userVerified: options.userVerified ?? true,
    }),
  };

  const signInService = {
    issueSession: jest.fn().mockResolvedValue(USER_SUMMARY),
    completeSignIn: jest
      .fn()
      .mockResolvedValue(
        options.owesSecondFactor
          ? { requiresTwoFactor: true }
          : { requiresTwoFactor: false, user: USER_SUMMARY },
      ),
  };

  return {
    service: new PasskeyLoginService(
      new MongoPasskeyAccounts(
        createModelMock<ConstructorParameters<typeof MongoPasskeyAccounts>[0]>(
          userModel,
        ),
      ),
      partialMock<PasskeyAssertionService>(assertions),
      new MongoPasskeySignIn(partialMock<SignInService>(signInService)),
    ),
    assertions,
    signInService,
  };
}

describe('PasskeyLoginService', () => {
  const request = createMockRequest({});

  it('should hand the challenge options back to the client', async () => {
    const harness = createHarness({});
    const { response } = createMockResponse();

    const result = await harness.service.createOptions(response);

    expect(result.data.challenge).toBe('challenge');
    expect(harness.assertions.createOptions).toHaveBeenCalledWith(response);
  });

  it('should finish the sign-in when the passkey verified the user', async () => {
    const harness = createHarness({ userVerified: true });
    const { response } = createMockResponse();

    const result = await harness.service.verify(
      { response: CREDENTIAL_BODY },
      request,
      response,
    );

    expect(result.data).toEqual({
      requiresTwoFactor: false,
      user: USER_SUMMARY,
    });
    expect(harness.signInService.issueSession).toHaveBeenCalled();
    // User verification is the second factor, so the TOTP path is skipped.
    expect(harness.signInService.completeSignIn).not.toHaveBeenCalled();
  });

  it('should ask for a second factor when the passkey only proved possession', async () => {
    const harness = createHarness({
      userVerified: false,
      owesSecondFactor: true,
    });
    const { response } = createMockResponse();

    const result = await harness.service.verify(
      { response: CREDENTIAL_BODY },
      request,
      response,
    );

    expect(result.data).toEqual({ requiresTwoFactor: true, user: null });
    expect(harness.signInService.completeSignIn).toHaveBeenCalled();
    expect(harness.signInService.issueSession).not.toHaveBeenCalled();
  });

  it('should sign in a silent passkey when the account has no second factor', async () => {
    const harness = createHarness({
      userVerified: false,
      owesSecondFactor: false,
    });
    const { response } = createMockResponse();

    const result = await harness.service.verify(
      { response: CREDENTIAL_BODY },
      request,
      response,
    );

    expect(result.data).toEqual({
      requiresTwoFactor: false,
      user: USER_SUMMARY,
    });
  });

  it('should refuse a credential whose account was deleted', async () => {
    const harness = createHarness({
      user: { _id: USER_ID, email: 'user@example.com', isDeleted: true },
    });
    const { response } = createMockResponse();

    await expect(
      harness.service.verify({ response: CREDENTIAL_BODY }, request, response),
    ).rejects.toMatchObject({
      code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
      status: 401,
    });
    expect(harness.signInService.issueSession).not.toHaveBeenCalled();
  });

  it('should refuse a credential whose account is gone', async () => {
    const harness = createHarness({ user: null });
    const { response } = createMockResponse();

    await expect(
      harness.service.verify({ response: CREDENTIAL_BODY }, request, response),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_VERIFICATION_FAILED });
  });

  it('should pass on a failed assertion untouched', async () => {
    const harness = createHarness({});
    harness.assertions.verify.mockRejectedValue(new Error('bad signature'));
    const { response } = createMockResponse();

    await expect(
      harness.service.verify({ response: CREDENTIAL_BODY }, request, response),
    ).rejects.toThrow('bad signature');
  });
});
