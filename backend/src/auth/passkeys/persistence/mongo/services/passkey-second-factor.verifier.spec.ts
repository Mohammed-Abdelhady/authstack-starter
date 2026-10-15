import { browserApplicationsForTest } from '../../../../../common/testing/browser-applications.harness-spec';
import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { AuthFeaturesService } from '../../../../services/features/auth-features.service';
import { PasskeyAssertionService } from '../../../services/passkey-assertion.service';
import { PasskeySecondFactorVerifier } from '../../../services/passkey-second-factor.verifier';
import {
  CREDENTIAL_BODY,
  OTHER_USER_ID,
  USER_ID,
} from '../passkeys.harness-spec';
import {
  createRequestMock,
  createResponseMock,
  partialMock,
} from '../../../../../common/testing/test-doubles.harness-spec';

const MOCK_REQUEST = createRequestMock({ cookies: {} });
const MOCK_RESPONSE = createResponseMock({});
const USER = { id: USER_ID.toString() };
/** The held sign-in a password opened, and the one a passkey alone opened. */
const AFTER_PASSWORD = { firstFactor: 'password' } as const;
const AFTER_PASSKEY = { firstFactor: 'passkey' } as const;

interface Harness {
  verifier: PasskeySecondFactorVerifier;
  assertions: { verify: jest.Mock };
}

function createHarness(
  passkeyOwner: Types.ObjectId = USER_ID,
  passkeysEnabled = true,
): Harness {
  const assertions = {
    verify: jest.fn().mockResolvedValue({
      passkey: { userId: passkeyOwner.toString() },
      userVerified: true,
    }),
  };

  const config = Object.assign(new ConfigService(), {
    get: jest.fn((key: string, fallback?: boolean) =>
      key === 'passkeys.enabled' ? passkeysEnabled : fallback,
    ),
  });
  const browserApplications = browserApplicationsForTest(config);
  const authFeaturesService = new AuthFeaturesService(
    config,
    browserApplications,
  );

  return {
    verifier: new PasskeySecondFactorVerifier(
      authFeaturesService,
      partialMock<PasskeyAssertionService>(assertions),
    ),
    assertions,
  };
}

describe('PasskeySecondFactorVerifier', () => {
  it('should claim a payload carrying a credential, and nothing else', () => {
    const { verifier } = createHarness();

    expect(verifier.supports({ passkeyResponse: CREDENTIAL_BODY })).toBe(true);
    expect(verifier.supports({})).toBe(false);
  });

  it('should accept a credential registered to the account', async () => {
    const harness = createHarness();

    await harness.verifier.verify(
      { passkeyResponse: CREDENTIAL_BODY },
      USER,
      MOCK_REQUEST,
      MOCK_RESPONSE,
      AFTER_PASSWORD,
    );

    expect(harness.assertions.verify).toHaveBeenCalledWith(
      CREDENTIAL_BODY,
      MOCK_REQUEST,
      MOCK_RESPONSE,
    );
  });

  it('should refuse a credential registered to another account', async () => {
    const harness = createHarness(OTHER_USER_ID);

    await expect(
      harness.verifier.verify(
        { passkeyResponse: CREDENTIAL_BODY },
        USER,
        MOCK_REQUEST,
        MOCK_RESPONSE,
        AFTER_PASSWORD,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
      status: 401,
    });
  });

  it('should refuse anything while the method is off', async () => {
    const harness = createHarness(USER_ID, false);

    await expect(
      harness.verifier.verify(
        { passkeyResponse: CREDENTIAL_BODY },
        USER,
        MOCK_REQUEST,
        MOCK_RESPONSE,
        AFTER_PASSWORD,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.FEATURE_DISABLED,
      status: 404,
    });

    expect(harness.assertions.verify).not.toHaveBeenCalled();
  });

  it('should refuse a payload with no credential in it', async () => {
    const harness = createHarness();

    await expect(
      harness.verifier.verify(
        {},
        USER,
        MOCK_REQUEST,
        MOCK_RESPONSE,
        AFTER_PASSWORD,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_VERIFICATION_FAILED });

    expect(harness.assertions.verify).not.toHaveBeenCalled();
  });

  describe('a passkey that did not verify its user', () => {
    function answer(
      harness: Harness,
      signIn: typeof AFTER_PASSWORD | typeof AFTER_PASSKEY,
    ) {
      return harness.verifier.verify(
        { passkeyResponse: CREDENTIAL_BODY },
        USER,
        MOCK_REQUEST,
        MOCK_RESPONSE,
        signIn,
      );
    }

    function possessionOnly(): Harness {
      const harness = createHarness();
      harness.assertions.verify.mockResolvedValue({
        passkey: { userId: USER_ID.toString() },
        userVerified: false,
      });
      return harness;
    }

    it('should be refused after a first step that was a passkey', async () => {
      await expect(
        answer(possessionOnly(), AFTER_PASSKEY),
      ).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
        status: 401,
      });
    });

    it('should be accepted after a first step that was not a passkey', async () => {
      await expect(
        answer(possessionOnly(), AFTER_PASSWORD),
      ).resolves.toBeUndefined();
    });

    it('should not be what refuses one that did verify its user', async () => {
      await expect(
        answer(createHarness(), AFTER_PASSKEY),
      ).resolves.toBeUndefined();
    });
  });
});
