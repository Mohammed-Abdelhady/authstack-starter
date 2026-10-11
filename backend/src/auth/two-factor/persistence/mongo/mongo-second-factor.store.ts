import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { singleStatement } from '../../../../common/persistence/mongo/mongo-unique-conflict';
import {
  SecondFactorAccount,
  StoredTotpSecret,
} from '../../stores/second-factor-account';
import {
  ATTEMPT_RESERVATION,
  AttemptReservation,
  CountedAttempt,
  SecondFactorConfirmation,
  SecondFactorStore,
  SPEND_OUTCOME,
  SpendOutcome,
} from '../../stores/second-factor.store';

// A write goes through the document its record was read from, so Mongoose
// writes only what changed, the way the services did when they held it.
const DOCUMENTS = new WeakMap<SecondFactorAccount, UserDocument>();

/** The document behind a record a MongoDB read handed out. */
export function secondFactorDocumentOf(
  account: SecondFactorAccount,
): UserDocument {
  const user = DOCUMENTS.get(account);
  if (!user) {
    throw new Error('This account was not read from MongoDB');
  }
  return user;
}

/** The record for a document, tied to it for the writes that follow. */
export function toSecondFactorAccount(user: UserDocument): SecondFactorAccount {
  const state = user.twoFactor;
  const account: SecondFactorAccount = {
    id: user._id.toString(),
    email: user.email,
    isDeleted: Boolean(user.isDeleted),
    passwordHash: user.password || undefined,
    twoFactor: {
      enabled: state?.enabled === true,
      secret: state?.secret
        ? {
            ciphertext: state.secret.ciphertext,
            iv: state.secret.iv,
            tag: state.secret.tag,
          }
        : null,
      confirmedAt: state?.confirmedAt ?? null,
      recoveryCodes: (state?.recoveryCodes ?? []).map((code) => ({
        hash: code.hash,
        usedAt: code.usedAt ?? null,
      })),
      lastUsedStep: state?.lastUsedStep ?? null,
      failedAttempts: state?.failedAttempts ?? 0,
      lockedUntil: state?.lockedUntil ?? null,
    },
  };
  DOCUMENTS.set(account, user);
  return account;
}

function recordOf(user: UserDocument | null): SecondFactorAccount | null {
  return user ? toSecondFactorAccount(user) : null;
}

/** The second factor inside the user document, where it has always been. */
@Injectable()
export class MongoSecondFactorStore extends SecondFactorStore {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  isAccountId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }

  async findAccount(userId: string): Promise<SecondFactorAccount | null> {
    assertAccountId(userId);
    return singleStatement(async () =>
      recordOf(await this.userModel.findById(userId).exec()),
    );
  }

  async findAccountWithPassword(
    userId: string,
  ): Promise<SecondFactorAccount | null> {
    assertAccountId(userId);
    return singleStatement(async () =>
      recordOf(
        await this.userModel.findById(userId).select('+password').exec(),
      ),
    );
  }

  async findChallengedAccount(
    userId: string,
  ): Promise<SecondFactorAccount | null> {
    assertAccountId(userId);
    return singleStatement(async () =>
      recordOf(await this.userModel.findById(userId)),
    );
  }

  async savePendingSecret(
    account: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<void> {
    const user = secondFactorDocumentOf(account);
    user.twoFactor = {
      enabled: false,
      secret,
      confirmedAt: null,
      recoveryCodes: [],
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
    };
    await singleStatement(() => user.save());
  }

  async saveConfirmation(
    account: SecondFactorAccount,
    confirmation: SecondFactorConfirmation,
  ): Promise<void> {
    const user = secondFactorDocumentOf(account);
    setRecoveryCodes(user, confirmation.recoveryCodeHashes);
    user.twoFactor.enabled = true;
    user.twoFactor.confirmedAt = confirmation.confirmedAt;
    await singleStatement(() => user.save());
  }

  async replaceRecoveryCodes(
    account: SecondFactorAccount,
    recoveryCodeHashes: string[],
  ): Promise<void> {
    const user = secondFactorDocumentOf(account);
    setRecoveryCodes(user, recoveryCodeHashes);
    await singleStatement(() => user.save());
  }

  async replaceSecret(
    account: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<void> {
    const readWith = account.twoFactor.secret;
    if (!readWith) return;
    const user = secondFactorDocumentOf(account);
    // Written around the document, so a later save of it leaves this alone.
    await singleStatement(() =>
      this.userModel.updateOne(
        { _id: user._id, 'twoFactor.secret.ciphertext': readWith.ciphertext },
        { $set: { 'twoFactor.secret': secret } },
      ),
    );
  }

  async clear(account: SecondFactorAccount): Promise<void> {
    const user = secondFactorDocumentOf(account);
    user.twoFactor = {
      enabled: false,
      secret: null,
      confirmedAt: null,
      recoveryCodes: [],
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
    };
    await singleStatement(() => user.save());
  }

  async spendTotpStep(
    account: SecondFactorAccount,
    step: number,
  ): Promise<SpendOutcome> {
    const user = secondFactorDocumentOf(account);
    const updated = await singleStatement(() =>
      this.userModel.updateOne(
        {
          _id: user._id,
          'twoFactor.lastUsedStep': account.twoFactor.lastUsedStep,
        },
        { $set: { 'twoFactor.lastUsedStep': step } },
      ),
    );

    if (updated.modifiedCount !== 1) {
      return SPEND_OUTCOME.ALREADY_SPENT;
    }

    // Keeps the document in step with what was stored, as the service did
    // when it held the document itself.
    user.twoFactor.lastUsedStep = step;
    return SPEND_OUTCOME.SPENT;
  }

  async reserveAttempt(
    account: SecondFactorAccount,
    attempt: CountedAttempt,
  ): Promise<AttemptReservation> {
    const user = secondFactorDocumentOf(account);
    const readWith = account.twoFactor.failedAttempts;
    // Written around the document, so a later save of it leaves the count
    // alone. A state stored before the count existed holds none.
    const counted = await singleStatement(() =>
      this.userModel.updateOne(
        {
          _id: user._id,
          'twoFactor.failedAttempts':
            readWith === 0 ? { $in: [0, null] } : readWith,
        },
        {
          $set: {
            'twoFactor.failedAttempts': attempt.failedAttempts,
            'twoFactor.lockedUntil': attempt.lockedUntil,
          },
        },
      ),
    );
    return counted.modifiedCount === 1
      ? ATTEMPT_RESERVATION.RESERVED
      : ATTEMPT_RESERVATION.REFUSED;
  }

  async clearFailedAttempts(account: SecondFactorAccount): Promise<void> {
    const user = secondFactorDocumentOf(account);
    await singleStatement(() =>
      this.userModel.updateOne(
        { _id: user._id },
        {
          $set: {
            'twoFactor.failedAttempts': 0,
            'twoFactor.lockedUntil': null,
          },
        },
      ),
    );
  }

  async spendRecoveryCode(
    account: SecondFactorAccount,
    hash: string,
    usedAt: Date,
  ): Promise<SpendOutcome> {
    const user = secondFactorDocumentOf(account);
    const updated = await singleStatement(() =>
      this.userModel.updateOne(
        {
          _id: user._id,
          'twoFactor.recoveryCodes': { $elemMatch: { hash, usedAt: null } },
        },
        { $set: { 'twoFactor.recoveryCodes.$.usedAt': usedAt } },
      ),
    );

    if (updated.modifiedCount !== 1) {
      return SPEND_OUTCOME.ALREADY_SPENT;
    }

    const spent = user.twoFactor.recoveryCodes.find(
      (code) => code.hash === hash && code.usedAt === null,
    );
    if (spent) {
      spent.usedAt = usedAt;
    }
    return SPEND_OUTCOME.SPENT;
  }
}

function assertAccountId(id: string): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new MalformedIdError();
  }
}

function setRecoveryCodes(user: UserDocument, hashes: string[]): void {
  user.twoFactor.recoveryCodes = hashes.map((hash) => ({
    hash,
    usedAt: null,
  }));
  user.markModified('twoFactor.recoveryCodes');
}
