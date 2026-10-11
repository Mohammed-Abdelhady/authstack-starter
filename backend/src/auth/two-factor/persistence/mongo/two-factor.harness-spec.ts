import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import { HashService } from '../../../../common/services/hash.service';
import { TwoFactorService } from '../../two-factor.service';
import { TotpSecretCryptoService } from '../../services/totp-secret-crypto.service';
import { TwoFactorVerificationService } from '../../services/two-factor-verification.service';
import { passwordSwitch } from '../../services/password-switch.harness-spec';
import { TwoFactorReauthService } from '../../services/two-factor-reauth.service';
import { hashRecoveryCode } from '../../utils/recovery-code.util';
import { MongoSecondFactorStore } from './mongo-second-factor.store';
import {
  createModelMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';

/**
 * Shared setup for the two-factor specs.
 * The file ends in -spec.ts rather than .spec.ts: the build excludes it and
 * jest does not collect it as a suite of its own.
 */

export const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
/** 32 base32 characters, the 20 bytes otplib generates and its floor accepts. */
export const TOTP_SECRET = 'NYITGE7DZ7KUSQJFKLHJL2LZ6Z5IDTV7';
export const RECOVERY_CODE = 'K3M7QRTVWX';
export const USER_ID = new Types.ObjectId('507f1f77bcf86cd799439011');

export interface TwoFactorState {
  enabled: boolean;
  secret: { ciphertext: string; iv: string; tag: string } | null;
  confirmedAt: Date | null;
  recoveryCodes: { hash: string; usedAt: Date | null }[];
  lastUsedStep: number | null;
}

export interface MockUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: string;
  authProvider: string;
  isVerified: boolean;
  isDeleted: boolean;
  password?: string;
  twoFactor: TwoFactorState;
  save: jest.Mock;
  markModified: jest.Mock;
}

export interface TwoFactorHarness {
  service: TwoFactorService;
  crypto: TotpSecretCryptoService;
  userModel: { findById: jest.Mock };
  hashService: { hash: jest.Mock; compare: jest.Mock };
}

export function createCrypto(): TotpSecretCryptoService {
  return new TotpSecretCryptoService(
    new ConfigService({ 'twoFactor.encryptionKey': ENCRYPTION_KEY }),
  );
}

/** A signed-in account, by default with a password and no second factor. */
export function createUser(
  overrides: Partial<MockUser> = {},
  twoFactor: Partial<TwoFactorState> = {},
): MockUser {
  return {
    _id: USER_ID,
    email: 'user@example.com',
    name: 'Test User',
    role: 'user',
    authProvider: AuthProvider.EMAIL,
    isVerified: true,
    isDeleted: false,
    password: 'hashed-password',
    twoFactor: {
      enabled: false,
      secret: null,
      confirmedAt: null,
      recoveryCodes: [],
      lastUsedStep: null,
      ...twoFactor,
    },
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
    ...overrides,
  };
}

/** The same account with the second factor already confirmed. */
export function createEnabledUser(
  crypto: TotpSecretCryptoService,
  overrides: Partial<MockUser> = {},
): MockUser {
  return createUser(overrides, {
    enabled: true,
    secret: crypto.encrypt(TOTP_SECRET),
    confirmedAt: new Date(),
    recoveryCodes: [{ hash: hashRecoveryCode(RECOVERY_CODE), usedAt: null }],
  });
}

export function createHarness(user: MockUser | null): TwoFactorHarness {
  const query = {
    select: jest.fn(),
    exec: jest.fn().mockResolvedValue(user),
  };
  query.select.mockReturnValue(query);

  const userModel = {
    findById: jest.fn().mockReturnValue(query),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const hashService = {
    hash: jest.fn().mockResolvedValue('hashed-val'),
    compare: jest.fn().mockResolvedValue(true),
  };

  const crypto = createCrypto();
  const accounts = new MongoSecondFactorStore(
    createModelMock<ConstructorParameters<typeof MongoSecondFactorStore>[0]>(
      userModel,
    ),
  );

  return {
    service: new TwoFactorService(
      accounts,
      crypto,
      new TwoFactorVerificationService(accounts, crypto),
      new TwoFactorReauthService(
        partialMock<HashService>(hashService),
        passwordSwitch(true),
      ),
    ),
    crypto,
    userModel,
    hashService,
  };
}
