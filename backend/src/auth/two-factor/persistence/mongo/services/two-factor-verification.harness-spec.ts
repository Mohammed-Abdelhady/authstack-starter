import { generateSync } from 'otplib';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import {
  SecondFactorInput,
  TwoFactorVerificationService,
} from '../../../services/two-factor-verification.service';
import {
  MongoSecondFactorStore,
  toSecondFactorAccount,
} from '../mongo-second-factor.store';
import { TotpSecretCryptoService } from '../../../services/totp-secret-crypto.service';
import { generateTotpSecret } from '../../../utils/totp.util';
import { hashRecoveryCode } from '../../../utils/recovery-code.util';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import {
  TOTP_DIGITS,
  TOTP_STEP_MS,
  TOTP_STEP_SECONDS,
} from '../../../constants/two-factor.constants';
import {
  createModelMock,
  partialMock,
} from '../../../../../common/testing/test-doubles.harness-spec';

/**
 * Shared setup for the verification specs, which run against real codes.
 * The file ends in -spec.ts rather than .spec.ts: the build excludes it and
 * jest does not collect it as a suite of its own.
 */

const KEY = Buffer.alloc(32, 7).toString('base64');

export const RECOVERY_CODE = 'K3M7QRTVWX';

/**
 * A point in the middle of a step. Freezing the clock here keeps the step
 * arithmetic exact; a run that crossed a boundary would read one step out.
 */
export const FIXED_EPOCH_SECONDS = 1700000000;
export const FIXED_NOW_MS = FIXED_EPOCH_SECONDS * 1000;
export const CURRENT_STEP = Math.floor(FIXED_NOW_MS / TOTP_STEP_MS);

/** A code as an authenticator app would show it at the given step offset. */
export function codeAtOffset(secret: string, steps: number): string {
  return generateSync({
    secret,
    epoch: FIXED_EPOCH_SECONDS + steps * TOTP_STEP_SECONDS,
    period: TOTP_STEP_SECONDS,
    digits: TOTP_DIGITS,
  });
}

export interface MockUser {
  _id: Types.ObjectId;
  twoFactor: {
    enabled: boolean;
    secret: { ciphertext: string; iv: string; tag: string } | null;
    confirmedAt: Date | null;
    recoveryCodes: { hash: string; usedAt: Date | null }[];
    lastUsedStep: number | null;
  };
  save: jest.Mock;
  markModified: jest.Mock;
}

/**
 * The service as these specs call it, with the document they hold. Each call
 * reads the document into a record first, the way a store read does.
 */
export interface VerificationOnDocuments {
  verifySecondFactor(
    user: UserDocument,
    input: SecondFactorInput,
  ): Promise<void>;
  verifyTotpCode(user: UserDocument, code: string): Promise<void>;
  verifyRecoveryCode(user: UserDocument, recoveryCode: string): Promise<void>;
}

export interface VerificationHarness {
  service: VerificationOnDocuments;
  secret: string;
  user: UserDocument;
  save: jest.Mock;
  markModified: jest.Mock;
  userModel: { updateOne: jest.Mock };
}

export function createVerificationHarness(
  overrides: Partial<MockUser['twoFactor']> = {},
): VerificationHarness {
  const crypto = new TotpSecretCryptoService(
    new ConfigService({ 'twoFactor.encryptionKey': KEY }),
  );

  const secret = generateTotpSecret();
  const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const userModel = { updateOne };
  const save = jest.fn().mockResolvedValue(undefined);
  const markModified = jest.fn();

  /** One document the service and the assertions both hold. */
  const user = partialMock<UserDocument>({
    _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
    twoFactor: {
      enabled: true,
      secret: crypto.encrypt(secret),
      confirmedAt: new Date(),
      recoveryCodes: [{ hash: hashRecoveryCode(RECOVERY_CODE), usedAt: null }],
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
      ...overrides,
    },
    save,
    markModified,
  });

  const verification = new TwoFactorVerificationService(
    new MongoSecondFactorStore(
      createModelMock<ConstructorParameters<typeof MongoSecondFactorStore>[0]>(
        userModel,
      ),
    ),
    crypto,
  );

  return {
    service: {
      verifySecondFactor: (document, input) =>
        verification.verifySecondFactor(toSecondFactorAccount(document), input),
      verifyTotpCode: (document, code) =>
        verification.verifyTotpCode(toSecondFactorAccount(document), code),
      verifyRecoveryCode: (document, recoveryCode) =>
        verification.verifyRecoveryCode(
          toSecondFactorAccount(document),
          recoveryCode,
        ),
    },
    secret,
    user,
    save,
    markModified,
    userModel,
  };
}
