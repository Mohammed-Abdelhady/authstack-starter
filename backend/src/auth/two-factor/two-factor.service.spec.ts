// Real codes would need a clock and the library; the adapter stands in for
// both, so these tests drive the secret and the delta directly.
jest.mock('./utils/totp.util', () => ({
  generateTotpSecret: jest.fn(),
  buildOtpauthUrl: jest.fn(),
  checkTotpDelta: jest.fn(),
}));

import {
  buildOtpauthUrl,
  checkTotpDelta,
  generateTotpSecret,
} from './utils/totp.util';
import {
  createEnabledUser,
  createHarness,
  createUser,
  createCrypto,
  RECOVERY_CODE,
  TOTP_SECRET,
} from './persistence/mongo/two-factor.harness-spec';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  TWO_FACTOR_FRESH_SESSION_MS,
} from './constants/two-factor.constants';

const generateSecret = generateTotpSecret as jest.Mock;
const otpauthUrl = buildOtpauthUrl as jest.Mock;
const delta = checkTotpDelta as jest.Mock;

const USER_ID = '507f1f77bcf86cd799439011';
const FRESH_SESSION = { createdAt: new Date() };
const OLD_SESSION = {
  createdAt: new Date(Date.now() - TWO_FACTOR_FRESH_SESSION_MS - 1000),
};

describe('TwoFactorService', () => {
  beforeEach(() => {
    generateSecret.mockReset().mockReturnValue(TOTP_SECRET);
    otpauthUrl.mockReset().mockReturnValue('otpauth://totp/example');
    delta.mockReset();
  });

  describe('setup', () => {
    it('should store an unconfirmed secret once the password checks out', async () => {
      const user = createUser();
      const harness = createHarness(user);

      const result = await harness.service.setup(
        USER_ID,
        { password: 'Password123!' },
        undefined,
      );

      expect(harness.hashService.compare).toHaveBeenCalledWith(
        'Password123!',
        'hashed-password',
      );
      expect(result.data).toEqual({
        otpauthUrl: 'otpauth://totp/example',
        secret: TOTP_SECRET,
      });
      expect(user.twoFactor.enabled).toBe(false);
      expect(user.twoFactor.confirmedAt).toBeNull();
      expect(harness.crypto.decrypt(user.twoFactor.secret!)).toBe(TOTP_SECRET);
      expect(user.save).toHaveBeenCalled();
    });

    it('should refuse to start without the password on a password account', async () => {
      const harness = createHarness(createUser());

      await expect(
        harness.service.setup(USER_ID, {}, FRESH_SESSION),
      ).rejects.toMatchObject({ code: ErrorCode.REAUTH_REQUIRED, status: 401 });
    });

    it('should refuse to start when the password is wrong', async () => {
      const harness = createHarness(createUser());
      harness.hashService.compare.mockResolvedValue(false);

      await expect(
        harness.service.setup(USER_ID, { password: 'wrong' }, undefined),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CURRENT_PASSWORD,
        status: 400,
      });
    });

    it('should take a fresh session instead of a password on a passwordless account', async () => {
      const user = createUser({ password: undefined });
      const harness = createHarness(user);

      const result = await harness.service.setup(USER_ID, {}, FRESH_SESSION);

      expect(result.data.secret).toBe(TOTP_SECRET);
      expect(harness.hashService.compare).not.toHaveBeenCalled();
    });

    it('should refuse a passwordless account whose session is older than five minutes', async () => {
      const harness = createHarness(createUser({ password: undefined }));

      await expect(
        harness.service.setup(USER_ID, {}, OLD_SESSION),
      ).rejects.toMatchObject({ code: ErrorCode.REAUTH_REQUIRED });
    });

    it('should refuse to start over while the second factor is on', async () => {
      const harness = createHarness(createEnabledUser(createCrypto()));

      await expect(
        harness.service.setup(USER_ID, { password: 'Password123!' }, undefined),
      ).rejects.toMatchObject({
        code: ErrorCode.TWO_FACTOR_ALREADY_ENABLED,
        status: 409,
      });
    });
  });

  describe('confirm', () => {
    it('should turn the factor on and hand out ten recovery codes', async () => {
      const crypto = createCrypto();
      const user = createUser({}, { secret: crypto.encrypt(TOTP_SECRET) });
      const harness = createHarness(user);
      delta.mockReturnValue(0);

      const result = await harness.service.confirm(USER_ID, { code: '123456' });

      expect(delta).toHaveBeenCalledWith('123456', TOTP_SECRET);
      expect(result.data.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      result.data.recoveryCodes.forEach((code) => {
        expect(code).toMatch(new RegExp(`^[A-Z2-7]{${RECOVERY_CODE_LENGTH}}$`));
      });
      expect(user.twoFactor.enabled).toBe(true);
      expect(user.twoFactor.confirmedAt).toEqual(expect.any(Date));
      expect(user.twoFactor.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('should leave the factor off when the code does not match', async () => {
      const crypto = createCrypto();
      const user = createUser({}, { secret: crypto.encrypt(TOTP_SECRET) });
      const harness = createHarness(user);
      delta.mockReturnValue(null);

      await expect(
        harness.service.confirm(USER_ID, { code: '000000' }),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
      expect(user.twoFactor.enabled).toBe(false);
      expect(user.twoFactor.recoveryCodes).toHaveLength(0);
    });

    it('should refuse a confirm that never ran setup', async () => {
      const harness = createHarness(createUser());

      await expect(
        harness.service.confirm(USER_ID, { code: '123456' }),
      ).rejects.toMatchObject({
        code: ErrorCode.TWO_FACTOR_SETUP_REQUIRED,
        status: 400,
      });
    });

    it('should refuse to confirm twice', async () => {
      const harness = createHarness(createEnabledUser(createCrypto()));

      await expect(
        harness.service.confirm(USER_ID, { code: '123456' }),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_ALREADY_ENABLED });
    });
  });

  describe('disable', () => {
    it('should clear the secret and the recovery codes', async () => {
      const user = createEnabledUser(createCrypto());
      const harness = createHarness(user);
      delta.mockReturnValue(0);

      const result = await harness.service.disable(USER_ID, {
        code: '123456',
        password: 'Password123!',
      });

      expect(result.success).toBe(true);
      expect(user.twoFactor).toEqual({
        enabled: false,
        secret: null,
        confirmedAt: null,
        recoveryCodes: [],
        lastUsedStep: null,
        failedAttempts: 0,
        lockedUntil: null,
      });
    });

    it('should accept a recovery code in place of a code', async () => {
      const user = createEnabledUser(createCrypto());
      const harness = createHarness(user);

      await harness.service.disable(USER_ID, {
        recoveryCode: RECOVERY_CODE,
        password: 'Password123!',
      });

      expect(user.twoFactor.enabled).toBe(false);
      expect(delta).not.toHaveBeenCalled();
    });

    it('should keep the factor on when the password is wrong', async () => {
      const user = createEnabledUser(createCrypto());
      const harness = createHarness(user);
      harness.hashService.compare.mockResolvedValue(false);
      delta.mockReturnValue(0);

      await expect(
        harness.service.disable(USER_ID, { code: '123456', password: 'wrong' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CURRENT_PASSWORD });
      expect(user.twoFactor.enabled).toBe(true);
    });

    it('should keep the factor on when the code is wrong', async () => {
      const user = createEnabledUser(createCrypto());
      const harness = createHarness(user);
      delta.mockReturnValue(null);

      await expect(
        harness.service.disable(USER_ID, {
          code: '000000',
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
      expect(user.twoFactor.enabled).toBe(true);
    });

    it('should refuse an account that has nothing to turn off', async () => {
      const harness = createHarness(createUser());

      await expect(
        harness.service.disable(USER_ID, { code: '123456' }),
      ).rejects.toMatchObject({
        code: ErrorCode.TWO_FACTOR_NOT_ENABLED,
        status: 400,
      });
    });
  });

  describe('regenerateRecoveryCodes', () => {
    it('should replace every code, spent or not', async () => {
      const user = createEnabledUser(createCrypto());
      const previous = user.twoFactor.recoveryCodes[0].hash;
      const harness = createHarness(user);
      delta.mockReturnValue(0);

      const result = await harness.service.regenerateRecoveryCodes(USER_ID, {
        code: '123456',
        password: 'Password123!',
      });

      expect(result.data.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(
        user.twoFactor.recoveryCodes.map((entry) => entry.hash),
      ).not.toContain(previous);
    });

    it('should refuse without a valid code', async () => {
      const user = createEnabledUser(createCrypto());
      const previous = user.twoFactor.recoveryCodes;
      const harness = createHarness(user);
      delta.mockReturnValue(null);

      await expect(
        harness.service.regenerateRecoveryCodes(USER_ID, {
          code: '000000',
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.TWO_FACTOR_CODE_INVALID });
      expect(user.twoFactor.recoveryCodes).toBe(previous);
    });
  });
});
