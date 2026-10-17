import type { Selectable } from 'kysely';
import { storedAddress } from '../../src/auth/persistence/postgres/postgres-pending-codes-database';
import { EMAIL_PROVIDER } from '../../src/common/constants/oauth-providers';
import type { PostgresDatabase } from '../../src/common/persistence/postgres/postgres-connection';
import type {
  ApplicationsTable,
  UsersTable,
} from '../../src/common/persistence/postgres/postgres-database';
import { DEFAULT_API_AUDIENCE } from '../../src/session/constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../src/session/constants/session-policy';
import type {
  E2eAccountsState,
  E2eApplicationsState,
  E2eSessionsState,
  E2eStoredAccount,
  E2eStoredApplication,
} from '../utils/e2e-state-shared';

function storedAccount(
  row: Selectable<UsersTable> | undefined,
  withPassword: boolean,
): E2eStoredAccount | null {
  if (!row) return null;
  return {
    _id: row.id,
    email: row.email ?? '',
    name: row.name ?? '',
    role: row.role,
    ...(row.audience ? { audience: row.audience } : {}),
    permissions: row.permissions,
    isVerified: row.is_verified,
    isDeleted: row.is_deleted,
    pendingEmail: row.pending_email ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    addressGeneration: row.address_generation,
    locale: row.locale,
    password: withPassword ? (row.password_hash ?? undefined) : undefined,
  };
}

function storedApplication(
  row: Selectable<ApplicationsTable> | undefined,
): E2eStoredApplication | null {
  if (!row) return null;
  return {
    clientId: row.client_id,
    ...(row.account_audience ? { accountAudience: row.account_audience } : {}),
    displayName: row.display_name,
    platform: row.platform,
    clientType: row.client_type,
    enabled: row.enabled,
    redirectUris: row.redirect_uris,
    allowedOrigins: row.allowed_origins,
  };
}

/**
 * Accounts on PostgreSQL, through the adapter's own table map. An address is
 * stored and looked up the way the adapter does it, and the sign-in provider
 * is the default the other database's schema gives.
 */
export function postgresAccountsState(
  database: PostgresDatabase,
): E2eAccountsState {
  return {
    seedAccounts: async (accounts) => {
      await database
        .insertInto('users')
        .values(
          accounts.map((account) => ({
            email: account.email,
            name: account.name,
            role: account.role,
            permissions: account.permissions,
            password_hash: account.password,
            is_verified: account.isVerified,
            auth_provider: EMAIL_PROVIDER,
            primary_provider: EMAIL_PROVIDER,
          })),
        )
        .execute();
    },
    createAccount: async (account) => {
      const created = await database
        .insertInto('users')
        .values({
          email: storedAddress(account.email),
          name: account.name.trim(),
          role: account.role,
          is_verified: account.isVerified ?? false,
          is_deleted: account.isDeleted ?? false,
          pending_email: account.pendingEmail
            ? storedAddress(account.pendingEmail)
            : null,
          address_generation: account.addressGeneration ?? 0,
          password_hash: account.password ?? null,
          auth_provider: EMAIL_PROVIDER,
          ...(account.locale === undefined ? {} : { locale: account.locale }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { _id: created.id };
    },
    accountIdFor: async (email) => {
      const row = await database
        .selectFrom('users')
        .select('id')
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row ? row.id : null;
    },
    accountWithAddress: async (email) =>
      storedAccount(
        await database
          .selectFrom('users')
          .selectAll()
          .where('email', '=', storedAddress(email))
          .executeTakeFirst(),
        true,
      ),
    accountWithId: async (id) =>
      storedAccount(
        await database
          .selectFrom('users')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst(),
        false,
      ),
  };
}

export function postgresSessionsState(
  database: PostgresDatabase,
): E2eSessionsState {
  return {
    sessionIdWithPurpose: async (purpose) => {
      const row = await database
        .selectFrom('sessions')
        .select('id')
        .where('credential_purpose', '=', purpose)
        .executeTakeFirst();
      return row ? row.id : null;
    },
    countSessions: async () => {
      const rows = await database.selectFrom('sessions').select('id').execute();
      return rows.length;
    },
    session: async (id) => {
      const row = await database
        .selectFrom('sessions')
        .select(['is_valid', 'proof_key_thumbprint'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return null;
      return {
        isValid: row.is_valid,
        ...(row.proof_key_thumbprint === null
          ? {}
          : { proofKeyThumbprint: row.proof_key_thumbprint }),
      };
    },
  };
}

export function postgresApplicationsState(
  database: PostgresDatabase,
): E2eApplicationsState {
  return {
    createApplication: async (application) => {
      await database
        .insertInto('applications')
        .values({
          client_id: application.clientId,
          account_audience: application.accountAudience ?? null,
          display_name: application.displayName,
          platform: application.platform,
          environment: application.environment,
          client_type: application.clientType,
          enabled: application.enabled,
          redirect_uris: application.redirectUris,
          allowed_origins: application.allowedOrigins,
          audiences: application.audiences,
          allowed_scopes: application.allowedScopes,
          absolute_lifetime_ms: application.policy.absoluteLifetimeMs,
          idle_lifetime_ms: application.policy.idleLifetimeMs,
          session_version: application.sessionVersion,
        })
        .execute();
    },
    // The columns with a default are filled the way the adapter fills them.
    registerBrowserApplication: async (application) => {
      await database
        .insertInto('applications')
        .values({
          client_id: application.clientId,
          display_name: application.displayName,
          platform: application.platform,
          environment: application.environment,
          client_type: application.clientType,
          allowed_origins: application.allowedOrigins,
          audiences: [DEFAULT_API_AUDIENCE],
          allowed_scopes: [DEFAULT_API_AUDIENCE],
          absolute_lifetime_ms: WEB_ABSOLUTE_LIFETIME_MS,
          idle_lifetime_ms: WEB_IDLE_LIFETIME_MS,
        })
        .execute();
    },
    application: async (clientId, environment) => {
      let query = database
        .selectFrom('applications')
        .selectAll()
        .where('client_id', '=', clientId);
      if (environment !== undefined) {
        query = query.where('environment', '=', environment);
      }
      return storedApplication(await query.executeTakeFirst());
    },
    applicationCount: async (clientId) => {
      const rows = await database
        .selectFrom('applications')
        .select('client_id')
        .where('client_id', '=', clientId)
        .execute();
      return rows.length;
    },
    applicationCountIn: async (environment) => {
      const rows = await database
        .selectFrom('applications')
        .select('client_id')
        .where('environment', '=', environment)
        .execute();
      return rows.length;
    },
    removeApplicationsIn: async (environment) => {
      await database
        .deleteFrom('applications')
        .where('environment', '=', environment)
        .execute();
    },
    changeApplication: async (clientId, change) => {
      await database
        .updateTable('applications')
        .set({
          ...(change.enabled === undefined ? {} : { enabled: change.enabled }),
          ...(change.accountAudience === undefined
            ? {}
            : { account_audience: change.accountAudience }),
          ...(change.redirectUris === undefined
            ? {}
            : { redirect_uris: change.redirectUris }),
        })
        .where('client_id', '=', clientId)
        .execute();
    },
    storeApplicationRedirects: async (clientId, redirectUris) => {
      await database
        .updateTable('applications')
        .set({ redirect_uris: redirectUris })
        .where('client_id', '=', clientId)
        .execute();
    },
  };
}
