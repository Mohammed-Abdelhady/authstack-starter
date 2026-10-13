import { UserDocument } from '../../../../user/persistence/mongo/schemas/user.schema';
import { SecondFactorAccount } from '../../stores/second-factor-account';

const DOCUMENTS = new WeakMap<SecondFactorAccount, UserDocument>();

export function secondFactorDocumentOf(
  account: SecondFactorAccount,
): UserDocument {
  const user = DOCUMENTS.get(account);
  if (!user) throw new Error('This account was not read from MongoDB');
  return user;
}

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

export function recordOf(
  user: UserDocument | null,
): SecondFactorAccount | null {
  return user ? toSecondFactorAccount(user) : null;
}
