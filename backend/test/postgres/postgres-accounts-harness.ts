import { postgresAccountsIssuance } from './postgres-accounts-issuance';
import { postgresAccountsApplications } from './postgres-accounts-applications';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { PostgresAddressLedger } from '../../src/common/persistence/postgres/postgres-address-ledger';
import { ADDRESS_CLAIM_KIND } from '../../src/common/persistence/address-ledger';
import {
  ActivatedAccount,
  ActivationSignIn,
  ActivationSignInOutcome,
} from '../../src/auth/pending-codes/activation-accounts';
import { SessionRevoker } from '../../src/session/revocation/session-revoker';
import { RevokerAccountSessions } from '../../src/user/stores/revoker-account-sessions';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import {
  issueOnlyTheRefusedEventId,
  REFUSED_EVENT_ID,
  REFUSED_EVENT_SEED_ACTION,
  REFUSED_EVENT_SEED_OUTCOME,
} from '../utils/refused-event';
import { AccountsContractHarness } from '../utils/user/accounts-contract/accounts-contract-harness';
import { PostgresAccountPermissionStore } from '../../src/user/persistence/postgres/postgres-account-permission.store';
import { PostgresAccountProfileStore } from '../../src/user/persistence/postgres/postgres-account-profile.store';
import {
  activatedSignInAccountOf,
  PostgresActivationAccounts,
} from '../../src/auth/persistence/postgres/postgres-activation-accounts';
import { PostgresIdFormat } from '../../src/common/persistence/postgres/postgres-id-format';
import { PostgresAdminAccountStore } from '../../src/admin/persistence/postgres/postgres-admin-account.store';
import { PostgresTables } from '../../src/common/persistence/postgres/postgres-database';
import { PostgresMailCounterStore } from '../../src/auth/persistence/postgres/postgres-mail-counter.store';
import { PostgresPasswordSignInStore } from '../../src/auth/persistence/postgres/postgres-password-sign-in.store';
import { PostgresPendingRegistrationStore } from '../../src/auth/persistence/postgres/postgres-pending-registration.store';
import { PostgresRoleCatalogStore } from '../../src/role/persistence/postgres/postgres-role-catalog.store';
import { PostgresRolePermissions } from '../../src/role/persistence/postgres/postgres-role-permissions';
import { PostgresRoleChangeStore } from '../../src/role/persistence/postgres/postgres-role-change.store';
import { PostgresRoleSweepStore } from '../../src/role/persistence/postgres/postgres-role-sweep.store';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresSessionRevocationStore } from '../../src/session/persistence/postgres/postgres-session-revocation.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from './postgres-connection';

/**
 * Answers with the account the activation stored and issues nothing, the way
 * the stand-in on the other database does, so both run the same cases.
 */
class SummarySignIn extends ActivationSignIn {
  recordCreationRefusal(_clientId: string): Promise<void> {
    return Promise.resolve();
  }

  complete(account: ActivatedAccount): Promise<ActivationSignInOutcome> {
    const stored = activatedSignInAccountOf(account);
    return Promise.resolve({
      requiresTwoFactor: false,
      user: {
        id: stored.id,
        email: stored.email,
        name: stored.name,
        role: stored.role,
        authProvider: stored.authProvider,
        isVerified: stored.isVerified,
        permissions: [],
      },
    });
  }
}

const AN_OBJECT_ID = '65f000000000000000000001';
const TWO_HOURS_MS = 7_200_000;
const TEN_MINUTES_MS = 600_000;

export interface PostgresAccountsHarness extends AccountsContractHarness {
  readonly database: Kysely<PostgresTables>;
}

export async function bootPostgresAccountsHarness(): Promise<PostgresAccountsHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  const clock = new FrozenClock(TEST_NOW);
  const events = new PostgresSecurityEventStore(database);
  const creation = postgresAccountsApplications(database);

  return {
    database,
    clock,
    issuanceApplications: creation.issuanceApplications,
    sessionIssuance: postgresAccountsIssuance({
      database,
      clock,
      events,
      creation,
    }),
    configureCreationApplication: creation.configureCreationApplication,
    ledger: new PostgresAddressLedger(),
    claims: async () =>
      (
        await database
          .selectFrom('address_claims')
          .selectAll()
          .orderBy('address')
          .execute()
      ).map((row) => {
        const kind = Object.values(ADDRESS_CLAIM_KIND).find(
          (value) => value === row.kind,
        );
        if (!kind) throw new Error('unexpected stored claim kind');
        return {
          address: row.address,
          kind,
          owner: row.owner,
          lapsesAt: row.lapses_at,
        };
      }),
    emailChangeCode: async (email) => {
      const row = await database
        .selectFrom('pending_registrations')
        .select(['hashed_code', 'expires_at'])
        .where('email', '=', email)
        .where('purpose', '=', PENDING_PURPOSE.EMAIL_CHANGE)
        .executeTakeFirst();
      return row ? { hash: row.hashed_code, expiresAt: row.expires_at } : null;
    },
    profiles: new PostgresAccountProfileStore(database, clock),
    permissions: new PostgresAccountPermissionStore(database, clock),
    sessions: new RevokerAccountSessions(
      new SessionRevoker(
        new PostgresUnitOfWorkRunner(database),
        new PostgresSessionRevocationStore(clock, events),
        clock,
      ),
    ),
    admin: new PostgresAdminAccountStore(database, clock),
    activation: new PostgresActivationAccounts(database, clock),
    signIn: new SummarySignIn(),
    roleCatalog: new PostgresRoleCatalogStore(database),
    roleChanges: new PostgresRoleChangeStore(clock, events),
    roleSweeps: new PostgresRoleSweepStore(database, clock),
    registrations: new PostgresPendingRegistrationStore(database),
    mailCounters: new PostgresMailCounterStore(database),
    passwords: new PostgresPasswordSignInStore(database, clock),
    rolePermissions: new PostgresRolePermissions(database),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),

    alterRoleAudience: async (slug, audience) => {
      await sql`
        UPDATE roles SET audience = ${audience} WHERE slug = ${slug}
      `.execute(database);
    },
    seedRole: async (role) => {
      const at = clock.now();
      const row = await database
        .insertInto('roles')
        .values({
          name: role.name,
          slug: role.slug,
          audience: role.audience ?? null,
          level: role.level ?? null,
          permissions: role.permissions,
          created_at: at,
          updated_at: at,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    seedAccount: async (account) => {
      const row = await database
        .insertInto('users')
        .values({
          email: account.email,
          pending_email: account.pendingEmail ?? null,
          name: account.name ?? 'Contract Tester',
          role: account.role,
          audience: account.audience ?? null,
          permissions: account.permissions ?? [],
          password_hash: account.passwordHash ?? null,
          is_verified: account.verified ?? true,
          is_deleted: account.deleted ?? false,
          address_generation: account.addressGeneration ?? 0,
          auth_provider: 'email',
          created_at: account.createdAt ?? clock.now(),
          updated_at: account.createdAt ?? clock.now(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    seedSession: async (userId) => {
      const now = clock.now();
      const account = await database
        .selectFrom('users')
        .select('session_version')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      const row = await database
        .insertInto('sessions')
        .values({
          user_id: userId,
          token_hash: Buffer.from(randomUUID()),
          user_agent: 'Contract/1',
          device: null,
          ip: '127.0.0.1',
          client_id: 'web',
          user_version: account.session_version,
          client_version: 0,
          grant_version: 0,
          auth_epoch: 1,
          schema_version: 1,
          scopes: ['api'],
          audience: 'api',
          authentication_methods: [],
          credential_purpose: 'browser_session',
          browser_generation: 1,
          authenticated_at: now,
          last_used_at: now,
          last_activity_at: now,
          expires_at: new Date(now.getTime() + TWO_HOURS_MS),
          idle_expires_at: new Date(now.getTime() + TEN_MINUTES_MS),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    alterAccount: async (userId, change) => {
      await database
        .updateTable('users')
        .set({
          ...(change.role === undefined ? {} : { role: change.role }),
          ...(change.audience === undefined
            ? {}
            : { audience: change.audience }),
          ...(change.deleted === undefined
            ? {}
            : { is_deleted: change.deleted }),
          ...(change.email === undefined ? {} : { email: change.email }),
          ...(change.verified === undefined
            ? {}
            : { is_verified: change.verified }),
          ...(change.permissions === undefined
            ? {}
            : { permissions: change.permissions }),
        })
        .where('id', '=', userId)
        .execute();
    },
    removeRole: async (slug) => {
      await database.deleteFrom('roles').where('slug', '=', slug).execute();
    },

    account: async (userId) => {
      const row = await database
        .selectFrom('users')
        .selectAll()
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        email: row.email ?? '',
        pendingEmail: row.pending_email,
        name: row.name ?? '',
        role: row.role,
        ...(row.audience ? { audience: row.audience } : {}),
        permissions: row.permissions,
        passwordHash: row.password_hash,
        isVerified: row.is_verified,
        isDeleted: row.is_deleted,
        deletedAt: row.deleted_at,
        sessionVersion: row.session_version,
        addressGeneration: row.address_generation,
        authProvider: row.auth_provider,
        primaryProvider: row.primary_provider,
      };
    },
    accountIdByEmail: async (email) => {
      const row = await database
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      return row?.id ?? null;
    },
    liveSessionIds: async (userId) => {
      const rows = await database
        .selectFrom('sessions')
        .innerJoin('users', 'users.id', 'sessions.user_id')
        .select('sessions.id')
        .where('sessions.user_id', '=', userId)
        .where('sessions.is_valid', '=', true)
        .where('sessions.revoked_at', 'is', null)
        .whereRef('sessions.user_version', '=', 'users.session_version')
        .execute();
      return rows.map((row) => row.id).sort();
    },
    events: async () => {
      const rows = await database
        .selectFrom('security_events')
        .selectAll()
        .where('action', '!=', REFUSED_EVENT_SEED_ACTION)
        .execute();
      return rows.map((row) => ({
        targetUserId: row.target_user_id,
        actorId: row.actor_id,
        sessionId: row.session_id,
        action: row.action,
        reasonCode: row.reason_code,
        assignedRoleId: row.assigned_role_id,
        previousRoleId: row.previous_role_id,
        assignmentSessionVersion: row.assignment_session_version,
      }));
    },
    pendingRegistrations: async (email) => {
      const row = await database
        .selectFrom('pending_registrations')
        .select((select) => select.fn.countAll<string>().as('rows'))
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
      return Number(row.rows);
    },

    ids: new PostgresIdFormat(),
    absentId: () => randomUUID(),
    foreignId: () => AN_OBJECT_ID,

    refuseSecurityEvents: async () => {
      await database
        .insertInto('security_events')
        .values({
          event_id: REFUSED_EVENT_ID,
          action: REFUSED_EVENT_SEED_ACTION,
          outcome: REFUSED_EVENT_SEED_OUTCOME,
          occurred_at: TEST_NOW,
        })
        .onConflict((conflict) => conflict.column('event_id').doNothing())
        .execute();
      return issueOnlyTheRefusedEventId();
    },

    reset: async () => {
      await connection.reset();
      await creation.seedCreationApplications();
    },
    close: connection.close,
  };
}
