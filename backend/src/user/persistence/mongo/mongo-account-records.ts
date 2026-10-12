import { UserDocument } from './schemas/user.schema';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { isMongoDuplicateKeyError } from '../../../common/persistence/mongo/mongo-error.util';
import { ACCOUNT_CONSTRAINT, StoredAccount } from '../../stores/stored-account';

const EMAIL_INDEX = /index: email_1 /;

/**
 * A refused unique rule on an account as the shared error, anything else as it
 * came. The account has two rules: the address, and the linked identity.
 */
export function accountConflictOr(error: unknown): unknown {
  if (!isMongoDuplicateKeyError(error)) {
    return error;
  }
  const message: unknown = error.message;
  const constraint =
    typeof message === 'string' && EMAIL_INDEX.test(message)
      ? ACCOUNT_CONSTRAINT.EMAIL
      : ACCOUNT_CONSTRAINT.LINKED_IDENTITY;
  return new UniqueConflictError(constraint, error);
}

/** The record for a document. `id` is the one the caller asked with, if any. */
export function toStoredAccount(
  user: UserDocument,
  id?: string,
): StoredAccount {
  return {
    id: id ?? user._id.toString(),
    email: user.email,
    pendingEmail: user.pendingEmail,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    permissions: user.permissions ?? [],
    authProvider: user.authProvider,
    linkedAccounts: (user.linkedAccounts ?? []).map((account) => ({
      provider: account.provider,
      providerId: account.providerId,
      linkedAt: account.linkedAt,
    })),
    linkedProviders: user.linkedProviders,
    isVerified: Boolean(user.isVerified),
    isDeleted: Boolean(user.isDeleted),
    deletedAt: user.deletedAt,
    sessionVersion: user.sessionVersion ?? 0,
    addressGeneration: user.addressGeneration ?? 0,
    primaryProvider: user.primaryProvider,
    profileSyncedAt: user.profileSyncedAt,
    lastSyncedProvider: user.lastSyncedProvider,
    twoFactorEnabled: user.twoFactor?.enabled === true, // feature:totp
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Keeps the document behind each record a store hands out, so a write goes
 * through the document that was read: Mongoose then writes only what changed
 * and applies its own versioning.
 */
export class MongoAccountDocuments {
  private readonly documents = new WeakMap<StoredAccount, UserDocument>();

  remember(user: UserDocument, id?: string): StoredAccount;
  remember(user: UserDocument | null, id?: string): StoredAccount | null;
  remember(user: UserDocument | null, id?: string): StoredAccount | null {
    if (!user) return null;
    const account = toStoredAccount(user, id);
    this.documents.set(account, user);
    return account;
  }

  /** The document a record was made from. The id carries over to the next record. */
  documentOf(account: StoredAccount): UserDocument {
    const user = this.documents.get(account);
    if (!user) {
      throw new Error('This account was not read by this store');
    }
    return user;
  }
}
