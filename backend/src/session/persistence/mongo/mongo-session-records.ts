import { Types } from 'mongoose';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { isCastError } from '../../../common/persistence/mongo/mongo-error.util';
import {
  LeanUser,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  AccountIdentity,
  AuthorityAccount,
  StoredSession,
} from '../../authority/session-authority.store';
import { deviceLabelOf } from '../../issuance/browser-issuance.store';
import { RevocableSession } from '../../revocation/session-revocation.store';
import { LeanSession, SessionDocument } from './schemas/session.schema';
import { toIssuanceAccount } from './mongo-issuance-mappers';

type SessionRecord = SessionDocument | LeanSession;

/**
 * The documents behind what the store handed out. Callers that still speak
 * Mongoose get the document back through here; the port never carries it.
 */
const sessionRecords = new WeakMap<StoredSession, SessionRecord>();
const accountRecords = new WeakMap<AuthorityAccount, UserDocument>();

function isHydrated(record: SessionRecord): record is SessionDocument {
  return 'toObject' in record && typeof record.toObject === 'function';
}

/** A session read as a plain object may carry its account in place of the id. */
function ownerIdOf(record: SessionRecord): string {
  const owner = record.user;
  return owner instanceof Types.ObjectId
    ? owner.toString()
    : owner._id.toString();
}

/** Stored values go across as they are: the service judges what is missing. */
export function toStoredSession(record: SessionRecord): StoredSession {
  const stored: StoredSession = {
    id: record._id.toString(),
    userId: ownerIdOf(record),
    userAgent: record.userAgent,
    ip: record.ip,
    device: record.device ? deviceLabelOf(record.device) : null,
    deviceName: record.deviceName ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
    proofKeyThumbprint: record.proofKeyThumbprint ?? null,
    csrfToken: record.csrfToken ?? null,
    authenticationMethods: [...(record.authenticationMethods ?? [])],
    createdAt: record.createdAt,
    isValid: record.isValid,
    revokedAt: record.revokedAt ?? null,
    credentialPurpose: record.credentialPurpose,
    authEpoch: record.authEpoch,
    schemaVersion: record.schemaVersion,
    clientId: record.clientId,
    userVersion: record.userVersion,
    clientVersion: record.clientVersion,
    grantVersion: record.grantVersion,
    authenticatedAt: record.authenticatedAt,
    expiresAt: record.expiresAt,
    idleExpiresAt: record.idleExpiresAt,
    lastActivityAt: record.lastActivityAt,
  };
  sessionRecords.set(stored, record);
  return stored;
}

export function toAuthorityAccount(user: UserDocument): AuthorityAccount {
  const account = toIssuanceAccount(user);
  accountRecords.set(account, user);
  return account;
}

export function toAccountIdentity(user: UserDocument): AccountIdentity {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: [...(user.permissions ?? [])],
    isVerified: Boolean(user.isVerified),
    isDeleted: Boolean(user.isDeleted),
  };
}

/** The document a committed read handed out, if this adapter still holds it. */
export function authorityDocumentOf(
  account: AuthorityAccount,
): UserDocument | undefined {
  return accountRecords.get(account);
}

export function toRevocableSession(record: SessionDocument): RevocableSession {
  return {
    id: record._id.toString(),
    userId: record.user.toString(),
    clientId: record.clientId,
    isValid: record.isValid,
    revoked: Boolean(record.revokedAt),
    userVersion: record.userVersion ?? -1,
  };
}

/** The session as Mongoose callers know it. Throws for one this adapter did not read. */
export function leanSessionOf(stored: StoredSession): LeanSession {
  const record = sessionRecords.get(stored);
  if (!record) {
    throw new Error('This session was not read by the MongoDB adapter');
  }
  return isHydrated(record) ? record.toObject<LeanSession>() : record;
}

export function leanUserOf(account: AuthorityAccount): LeanUser {
  const user = accountRecords.get(account);
  if (!user) {
    throw new Error('This account was not read by the MongoDB adapter');
  }
  return { ...user.toObject<LeanUser>() };
}

/** Runs a query Mongoose casts an id for, and names a failed cast. */
export async function castingId<Result>(
  query: () => Promise<Result>,
): Promise<Result> {
  try {
    return await query();
  } catch (error) {
    throw isCastError(error) ? new MalformedIdError(error) : error;
  }
}

/** Mongoose's own notion of an id it can look up. */
export function isStorableId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}
