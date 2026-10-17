jest.mock('otplib', () => ({
  ...jest.requireActual<typeof import('otplib')>('otplib'),
  generateSecret: () => 'NYITGE7DZ7KUSQJFKLHJL2LZ6Z5IDTV7',
}));

import {
  codeAtOffset,
  createVerificationHarness,
  CURRENT_STEP,
  FIXED_NOW_MS,
} from '../persistence/mongo/services/two-factor-verification.harness-spec';
import { ErrorCode } from '../../../common/enums/error-code.enum';

const OTHER_TEST_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * Runs against real codes rather than a stubbed adapter. The rules checked
 * here, the window and the refusal to spend a step twice, only mean anything
 * against codes an authenticator app would actually produce.
 */

describe('TwoFactorVerificationService', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('verifyTotpCode', () => {
    it('should accept a code one step behind and record that step', async () => {
      const { service, secret, user } = createVerificationHarness();

      await service.verifyTotpCode(user, codeAtOffset(secret, -1));

      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP - 1);
    });

    it('should reject a code from outside the window', async () => {
      const { service, secret, user, save } = createVerificationHarness();

      await expect(
        service.verifyTotpCode(user, codeAtOffset(secret, -2)),
      ).rejects.toMatchObject({
        code: ErrorCode.TWO_FACTOR_CODE_INVALID,
        status: 401,
      });
      expect(save).not.toHaveBeenCalled();
    });

    it('should reject a code generated from another secret', async () => {
      const { service, user } = createVerificationHarness();

      await expect(
        service.verifyTotpCode(user, codeAtOffset(OTHER_TEST_SECRET, 0)),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should reject a code of the wrong shape', async () => {
      const { service, user } = createVerificationHarness();

      await expect(
        service.verifyTotpCode(user, 'not-a-code'),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should reject an account with no secret to check against', async () => {
      const { service, user } = createVerificationHarness({ secret: null });

      await expect(
        service.verifyTotpCode(user, '123456'),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });
  });
});
