import {
  codeAtOffset,
  createVerificationHarness,
  CURRENT_STEP,
  FIXED_NOW_MS,
  RECOVERY_CODE,
} from '../persistence/mongo/services/two-factor-verification.harness-spec';
import { generateTotpSecret } from '../utils/totp.util';
import { ErrorCode } from '../../../common/enums/error-code.enum';

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
    it('should accept the code for the current step and remember it', async () => {
      const { service, secret, user, save } = createVerificationHarness();

      await service.verifyTotpCode(user, codeAtOffset(secret, 0));

      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP);
      expect(save).not.toHaveBeenCalled();
    });

    it('should accept a code one step behind and record that step', async () => {
      const { service, secret, user } = createVerificationHarness();

      await service.verifyTotpCode(user, codeAtOffset(secret, -1));

      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP - 1);
    });

    it('should accept a code one step ahead and record that step', async () => {
      const { service, secret, user } = createVerificationHarness();

      await service.verifyTotpCode(user, codeAtOffset(secret, 1));

      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP + 1);
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
        service.verifyTotpCode(user, codeAtOffset(generateTotpSecret(), 0)),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should reject the same code a second time', async () => {
      const { service, secret, user } = createVerificationHarness();
      const code = codeAtOffset(secret, 0);

      await service.verifyTotpCode(user, code);

      await expect(service.verifyTotpCode(user, code)).rejects.toMatchObject({
        code: ErrorCode.TWO_FACTOR_CODE_INVALID,
      });
      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP);
    });

    it('should reject an older step than the one already spent', async () => {
      const { service, secret, user } = createVerificationHarness({
        lastUsedStep: CURRENT_STEP,
      });

      await expect(
        service.verifyTotpCode(user, codeAtOffset(secret, -1)),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should refuse a TOTP step another request already spent', async () => {
      const { service, secret, user, userModel } = createVerificationHarness();
      userModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await expect(
        service.verifyTotpCode(user, codeAtOffset(secret, 0)),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should still accept the next step after one was spent', async () => {
      const { service, secret, user } = createVerificationHarness({
        lastUsedStep: CURRENT_STEP,
      });

      await service.verifyTotpCode(user, codeAtOffset(secret, 1));

      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP + 1);
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

  describe('verifyRecoveryCode', () => {
    it('should spend a recovery code once', async () => {
      const { service, user, save } = createVerificationHarness();

      await service.verifyRecoveryCode(user, RECOVERY_CODE);

      expect(user.twoFactor.recoveryCodes[0].usedAt).toEqual(expect.any(Date));
      expect(save).not.toHaveBeenCalled();
    });

    it('should refuse the same recovery code a second time', async () => {
      const { service, user } = createVerificationHarness();

      await service.verifyRecoveryCode(user, RECOVERY_CODE);

      await expect(
        service.verifyRecoveryCode(user, RECOVERY_CODE),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should accept a recovery code typed in lower case with dashes', async () => {
      const { service, user } = createVerificationHarness();

      await service.verifyRecoveryCode(user, 'k3m7q-rtvwx');

      expect(user.twoFactor.recoveryCodes[0].usedAt).toEqual(expect.any(Date));
    });

    it('should refuse a recovery code another request already spent', async () => {
      const { service, user, userModel } = createVerificationHarness();
      userModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await expect(
        service.verifyRecoveryCode(user, RECOVERY_CODE),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });

    it('should refuse a recovery code the account never had', async () => {
      const { service, user } = createVerificationHarness();

      await expect(
        service.verifyRecoveryCode(user, 'AAAAAAAAAA'),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
    });
  });

  describe('verifySecondFactor', () => {
    it('should take the code when both fields arrive', async () => {
      const { service, secret, user } = createVerificationHarness();

      await service.verifySecondFactor(user, {
        code: codeAtOffset(secret, 0),
        recoveryCode: RECOVERY_CODE,
      });

      expect(user.twoFactor.lastUsedStep).toBe(CURRENT_STEP);
      expect(user.twoFactor.recoveryCodes[0].usedAt).toBeNull();
    });

    it('should fall back to the recovery code when no code arrives', async () => {
      const { service, user } = createVerificationHarness();

      await service.verifySecondFactor(user, {
        recoveryCode: RECOVERY_CODE,
      });

      expect(user.twoFactor.recoveryCodes[0].usedAt).toEqual(expect.any(Date));
      expect(user.twoFactor.lastUsedStep).toBeNull();
    });

    it('should refuse an empty body', async () => {
      const { service, user } = createVerificationHarness();

      await expect(service.verifySecondFactor(user, {})).rejects.toMatchObject({
        code: ErrorCode.TWO_FACTOR_CODE_INVALID,
      });
    });
  });
});
