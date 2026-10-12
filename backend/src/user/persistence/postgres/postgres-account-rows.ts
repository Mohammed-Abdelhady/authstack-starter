import { Kysely, Transaction } from 'kysely';
import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../common/persistence/persistence-errors';
import { EMAIL_PROVIDER } from '../../../common/constants/oauth-providers';
import {
  ACCOUNT_CONSTRAINT,
  LinkedAccountRecord,
  linkedProvidersOf,
  StoredAccount,
} from '../../stores/stored-account';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { mapPostgresError } from '../../../common/persistence/postgres/postgres-persistence-errors';

export type AccountReader =
  Kysely<PostgresTables> | Transaction<PostgresTables>;

export const ACCOUNT_COLUMNS = [
  'id',
  'email',
  'pending_email',
  'name',
  'avatar_url',
  'role',
  'permissions',
  'auth_provider',
  'is_verified',
  'is_deleted',
  'deleted_at',
  'session_version',
  'address_generation',
  'primary_provider',
  'profile_synced_at',
  'last_synced_provider',
  'created_at',
  'updated_at',
] as const;

export interface AccountRow {
  id: string;
  email: string | null;
  pending_email: string | null;
  name: string | null;
  avatar_url: string | null;
  role: string;
  permissions: string[];
  auth_provider: string | null;
  is_verified: boolean;
  is_deleted: boolean;
  deleted_at: Date | null;
  session_version: number;
  address_generation: number;
  primary_provider: string | null;
  profile_synced_at: Date | null;
  last_synced_provider: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Constraint names on an account to the rules' shared names. */
const ACCOUNT_CONSTRAINTS: Readonly<Record<string, string>> = {
  user_email_unique: ACCOUNT_CONSTRAINT.EMAIL,
  user_linked_identity_unique: ACCOUNT_CONSTRAINT.LINKED_IDENTITY,
};

/** The account's unique rules by their shared names, anything else as mapped. */
export function accountFailure(error: unknown): unknown {
  if (error instanceof MalformedIdError) {
    return error;
  }
  const mapped = mapPostgresError(error);
  if (mapped instanceof UniqueConflictError) {
    return new UniqueConflictError(
      ACCOUNT_CONSTRAINTS[mapped.constraint] ?? mapped.constraint,
      error,
    );
  }
  return mapped;
}

/** Runs one statement that commits by itself and maps its failure. */
export async function accountStatement<Result>(
  statement: () => Promise<Result>,
): Promise<Result> {
  try {
    return await statement();
  } catch (error) {
    throw accountFailure(error);
  }
}

export async function linkedAccountsOf(
  reader: AccountReader,
  userId: string,
): Promise<LinkedAccountRecord[]> {
  const rows = await reader
    .selectFrom('user_linked_accounts')
    .select(['provider', 'provider_id', 'linked_at'])
    .where('user_id', '=', userId)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    provider: row.provider,
    providerId: row.provider_id,
    linkedAt: row.linked_at,
  }));
}

// feature:totp:start
/** Whether the account's second factor is confirmed and on. */
export async function secondFactorEnabled(
  reader: AccountReader,
  userId: string,
): Promise<boolean> {
  const row = await reader
    .selectFrom('user_two_factor')
    .select('enabled')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.enabled === true;
}
// feature:totp:end

export function toStoredAccount(
  row: AccountRow,
  linkedAccounts: LinkedAccountRecord[],
  twoFactorEnabled = false, // feature:totp
): StoredAccount {
  const authProvider = row.auth_provider ?? EMAIL_PROVIDER;
  return {
    id: row.id,
    email: row.email ?? '',
    pendingEmail: row.pending_email ?? undefined,
    name: row.name ?? '',
    avatarUrl: row.avatar_url ?? undefined,
    role: row.role,
    permissions: row.permissions,
    authProvider,
    linkedAccounts,
    linkedProviders: linkedProvidersOf({ authProvider, linkedAccounts }),
    isVerified: row.is_verified,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at ?? undefined,
    sessionVersion: row.session_version,
    addressGeneration: row.address_generation,
    primaryProvider: row.primary_provider ?? undefined,
    profileSyncedAt: row.profile_synced_at ?? undefined,
    lastSyncedProvider: row.last_synced_provider ?? undefined,
    twoFactorEnabled, // feature:totp
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The account with its links. With `take` the row is locked for this
 * transaction, and a second one that reaches it is refused at once.
 */
export async function readAccount(
  reader: AccountReader,
  userId: string,
  take = false,
): Promise<StoredAccount | null> {
  const query = reader
    .selectFrom('users')
    .select(ACCOUNT_COLUMNS)
    .where('id', '=', toUuid(userId));
  const row = await (
    take ? query.forNoKeyUpdate().noWait() : query
  ).executeTakeFirst();
  return row
    ? toStoredAccount(
        row,
        await linkedAccountsOf(reader, row.id),
        await secondFactorEnabled(reader, row.id), // feature:totp
      )
    : null;
}

/** The stored id of a record a store handed out. */
export function storedId(account: StoredAccount): string {
  return toUuid(account.id);
}
