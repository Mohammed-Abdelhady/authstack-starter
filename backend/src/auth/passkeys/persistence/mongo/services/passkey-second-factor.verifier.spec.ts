import { browserApplicationsForTest } from '../../../../../common/testing/browser-applications.harness-spec';
import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { AuthFeaturesService } from '../../../../services/features/auth-features.service';
import { PasskeyAssertionService } from '../../../services/passkey-assertion.service';
import { PasskeySecondFactorVerifier } from '../../../services/passkey-second-factor.verifier';
import { USER_ID } from '../passkeys.harness-spec';
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
});
