import { SessionsTable } from '../../../session/persistence/postgres/postgres-sessions.table';
import { ApplicationsTable } from '../../../session/persistence/postgres/postgres-applications.table';
import { RolesTable } from '../../../role/persistence/postgres/postgres-roles.table';
import { UsersTable } from '../../../user/persistence/postgres/postgres-users.table';
import { NativeAttemptsTable } from '../../../auth/native/persistence/postgres/postgres-native-attempt.table';
import { ColumnType, Generated, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { commitCheckedPool } from './postgres-commit-tag';
import {
  AuthorizationTransactionsTable,
  NativeCredentialsTable,
  NativeDpopProofIdsTable,
} from '../../../session/native/persistence/postgres/postgres-native-tables';

export type { UsersTable, RolesTable, ApplicationsTable, SessionsTable };

export type {
  AuthorizationTransactionsTable,
  NativeCredentialsTable,
  NativeDpopProofIdsTable,
} from '../../../session/native/persistence/postgres/postgres-native-tables';

type Timestamp = ColumnType<Date, Date, Date>;
/** `bigint` comes back as text. Lifetimes in milliseconds fit a number. */
type BigIntColumn = ColumnType<string, number, number>;

export interface UserLinkedAccountsTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  provider_id: string;
  linked_at: Timestamp;
}

// feature:totp:start
export interface UserTwoFactorTable {
  user_id: string;
  enabled: Generated<boolean>;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  secret_tag: string | null;
  confirmed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  last_used_step: number | null;
  failed_attempts: Generated<number>;
  locked_until: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface UserRecoveryCodesTable {
  id: Generated<string>;
  user_id: string;
  hash: string;
  used_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface TwoFactorChallengesTable {
  id: Generated<string>;
  user_id: string;
  nonce_hash: string;
  attempts: Generated<number>;
  claimed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  expires_at: Timestamp;
}
// feature:totp:end

// feature:passkeys:start
export interface PasskeysTable {
  id: Generated<string>;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  /** A signature count is an unsigned 32 bit number, past what `integer` holds. */
  counter: BigIntColumn;
  transports: Generated<string[]>;
  device_type: string | null;
  backed_up: Generated<boolean>;
  name: string;
  last_used_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PasskeyChallengesTable {
  id: Generated<string>;
  challenge_hash: string;
  purpose: string;
  user_id: string | null;
  expires_at: Timestamp;
}
// feature:passkeys:end

export interface RolePendingSweepsTable {
  id: Generated<string>;
  owner_role_id: string;
  role_id: string;
  previous_slug: string;
  actor_id: string;
  sweep_id: string | null;
}

export interface UserApplicationGrantsTable {
  id: Generated<string>;
  user_id: string;
  client_id: string;
  allowed: Generated<boolean>;
  allowed_scopes: Generated<string[]>;
  session_version: Generated<number>;
  issuance_fence: Generated<number>;
}

export interface SecurityEventsTable {
  id: Generated<string>;
  event_id: string;
  target_user_id: string | null;
  client_id: string | null;
  session_id: string | null;
  action: string;
  outcome: string;
  occurred_at: Timestamp;
  actor_id: string | null;
  reason_code: string | null;
  assigned_role_id: string | null;
  previous_role_id: string | null;
  assignment_session_version: number | null;
  deleted_role_id: string | null;
  deleted_role_slug: string | null;
  deletion_sweep_id: string | null;
  deletion_pending: boolean | null;
  request_id: string | null;
  purge_after: ColumnType<Date, Date | undefined, never>;
}

export interface BrowserProofsTable {
  id: Generated<string>;
  proof_id_hash: string;
  token_hash: string;
  expires_at: Timestamp;
  spent: Generated<boolean>;
}

export interface MailCountersTable {
  id: Generated<string>;
  email: string;
  purpose: string;
  mailed_codes: Generated<number>;
  window_started_at: Timestamp;
  expires_at: Timestamp;
  failed_guesses: Generated<number>;
  guess_lock_level: Generated<number>;
  guess_locked_until: Timestamp | null;
  guess_state_expires_at: Timestamp | null;
}

export interface PendingRegistrationsTable {
  id: Generated<string>;
  email: string;
  purpose: string;
  user_id: string | null;
  address_generation: number | null;
  hashed_code: string;
  attempts: Generated<number>;
  expires_at: Timestamp;
}

export interface PendingPasswordResetsTable {
  id: Generated<string>;
  email: string;
  hashed_code: string;
  attempts: Generated<number>;
  expires_at: Timestamp;
}

// feature:magic-link:start
export interface PendingMagicLinksTable {
  id: Generated<string>;
  email: string;
  token_hash: string;
  expires_at: Timestamp;
  consumed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  request_ip: string | null;
  user_agent: string | null;
  redirect: string | null;
  request_nonce_hash: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}
// feature:magic-link:end

export interface AddressClaimsTable {
  address: string;
  kind: string;
  owner: string;
  lapses_at: Timestamp;
}

export interface PostgresTables {
  address_claims: AddressClaimsTable;
  users: UsersTable;
  applications: ApplicationsTable;
  user_application_grants: UserApplicationGrantsTable;
  sessions: SessionsTable;
  security_events: SecurityEventsTable;
  roles: RolesTable;
  role_pending_sweeps: RolePendingSweepsTable;
  mail_counters: MailCountersTable;
  pending_registrations: PendingRegistrationsTable;
  pending_password_resets: PendingPasswordResetsTable;
  pending_magic_links: PendingMagicLinksTable; // feature:magic-link
  browser_proofs: BrowserProofsTable;
  user_linked_accounts: UserLinkedAccountsTable;
  user_two_factor: UserTwoFactorTable; // feature:totp
  user_recovery_codes: UserRecoveryCodesTable; // feature:totp
  two_factor_challenges: TwoFactorChallengesTable; // feature:totp
  passkeys: PasskeysTable; // feature:passkeys
  passkey_challenges: PasskeyChallengesTable; // feature:passkeys
  authorization_transactions: AuthorizationTransactionsTable;
  native_credentials: NativeCredentialsTable;
  native_dpop_proof_ids: NativeDpopProofIdsTable;
  native_attempts: NativeAttemptsTable;
}

/**
 * Opens the database on a pool that reads every COMMIT's command tag. A caller
 * that passes its own dialect builds it on `commitCheckedPool` too.
 */
export function openPostgresDatabase(
  pool: Pool,
  dialect: PostgresDialect = new PostgresDialect({
    pool: commitCheckedPool(pool),
  }),
): Kysely<PostgresTables> {
  return new Kysely<PostgresTables>({ dialect });
}
