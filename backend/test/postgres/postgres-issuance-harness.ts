import { SecurityEventRecorder } from '../../src/session/events/security-event-recorder';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { Pool } from 'pg';
import { RerunPause } from '../../src/common/persistence/unit-of-work';
import { AuthEpochService } from '../../src/common/services/auth-epoch.service';
import { SessionIssuanceService } from '../../src/session/services/session-issuance.service';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import {
  issueOnlyTheRefusedEventId,
  REFUSED_EVENT_ID,
  REFUSED_EVENT_SEED_ACTION,
  REFUSED_EVENT_SEED_OUTCOME,
} from '../utils/refused-event';
import {
  CONTRACT_AUTH_EPOCH,
  CONTRACT_ENVIRONMENT,
  IssuanceContractHarness,
} from '../utils/session/issuance-contract/issuance-contract-harness';
import { commitCheckedPool } from '../../src/common/persistence/postgres/postgres-commit-tag';
import { PostgresBrowserIssuanceStore } from '../../src/session/persistence/postgres/postgres-browser-issuance.store';
import { PostgresTables } from '../../src/common/persistence/postgres/postgres-database';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { PostgresApplicationRegistryStore } from '../../src/session/persistence/postgres/postgres-application-registry.store';
import { PostgresIssuanceApplications } from '../../src/session/persistence/postgres/postgres-issuance-applications';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnectionOn } from './postgres-connection';
import { CommitFaultDialect } from './postgres-commit-faults';
import { PostgresTestServer } from './server/postgres-test-server';

const AN_OBJECT_ID = '65f000000000000000000001';
const CLIENT_TYPES: Readonly<Record<string, string>> = {
  admin: 'confidential',
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PostgresIssuanceHarness extends IssuanceContractHarness {
  readonly database: Kysely<PostgresTables>;
  readonly pool: Pool;
  readonly server: PostgresTestServer;
  readonly appliedMigrations: string[];
}

export async function bootPostgresIssuanceHarness(): Promise<PostgresIssuanceHarness> {
  const connection = await openTestConnectionOn(
    (pool) => new CommitFaultDialect({ pool: commitCheckedPool(pool) }),
  );
  const { server, pool, database, appliedMigrations, dialect } = connection;
  const clock = new FrozenClock(TEST_NOW);
  const store = new PostgresBrowserIssuanceStore(
    CONTRACT_ENVIRONMENT,
    clock,
    new PostgresSecurityEventStore(database),
  );
  const authEpoch = new AuthEpochService(
    new ConfigService({
      auth: { epoch: CONTRACT_AUTH_EPOCH, nativeEnabled: false },
      server: { nodeEnv: CONTRACT_ENVIRONMENT },
    }),
  );
  const applications = new PostgresIssuanceApplications(
    new ApplicationRegistry(
      new PostgresUnitOfWorkRunner(database),
      new PostgresApplicationRegistryStore(database),
      authEpoch,
    ),
  );
  const runner = (pause: RerunPause) =>
    new PostgresUnitOfWorkRunner(database, pause);
  const known = (id: string): boolean => UUID_PATTERN.test(id);

  return {
    database,
    pool,
    server,
    appliedMigrations,
    clock,
    store,
    applications,
    runner,
    service: (pause) =>
      new SessionIssuanceService(
        runner(pause),
        store,
        applications,
        clock,
        authEpoch,
        new SecurityEventRecorder(
          new PostgresSecurityEventStore(database),
          clock,
        ),
      ),

    seedAccount: async (options) => {
      const row = await database
        .insertInto('users')
        .values({
          is_deleted: options?.deleted ?? false,
          audience: options?.audience,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    seedApplication: async (application) => {
      const values = {
        display_name: application.clientId,
        client_type: CLIENT_TYPES[application.clientId] ?? 'public',
        platform: application.platform,
        enabled: application.enabled,
        session_version: application.sessionVersion,
        policy_version: application.policyVersion ?? 0,
        account_audience: application.accountAudience ?? null,
        allowed_scopes: ['api'],
        absolute_lifetime_ms: application.absoluteLifetimeMs,
        idle_lifetime_ms: application.idleLifetimeMs,
      };
      await database
        .insertInto('applications')
        .values({
          client_id: application.clientId,
          environment: CONTRACT_ENVIRONMENT,
          ...values,
        })
        .onConflict((conflict) =>
          conflict.columns(['client_id', 'environment']).doUpdateSet(values),
        )
        .execute();
    },
    seedBlockedGrant: async (userId, clientId) => {
      await database
        .insertInto('user_application_grants')
        .values({
          user_id: userId,
          client_id: clientId,
          allowed: false,
          session_version: 1,
          issuance_fence: 0,
        })
        .execute();
    },
    revokeOneSession: async (userId) => {
      await database
        .updateTable('sessions')
        .set({ is_valid: false, revoked_at: clock.now() })
        .where('id', '=', (query) =>
          query
            .selectFrom('sessions')
            .select('id')
            .where('user_id', '=', userId)
            .limit(1),
        )
        .execute();
    },
    bumpAccountVersion: async (userId) => {
      await database
        .updateTable('users')
        .set((column) => ({
          session_version: column('session_version', '+', 1),
        }))
        .where('id', '=', userId)
        .execute();
    },

    account: async (userId) => {
      const row = await database
        .selectFrom('users')
        .select(['issuance_fence', 'session_version'])
        .where('id', '=', userId)
        .executeTakeFirst();
      return row
        ? {
            issuanceFence: row.issuance_fence,
            sessionVersion: row.session_version,
          }
        : null;
    },
    sessions: async (userId) => {
      const rows = known(userId)
        ? await database
            .selectFrom('sessions')
            .selectAll()
            .where('user_id', '=', userId)
            .execute()
        : [];
      return rows.map((row) => ({
        id: row.id,
        tokenHash: row.token_hash.toString('hex'),
        tokenHashBytes: row.token_hash.length,
        csrfToken: row.csrf_token,
        clientId: row.client_id,
        isValid: row.is_valid,
        revoked: row.revoked_at instanceof Date,
        userVersion: row.user_version,
        clientVersion: row.client_version,
        grantVersion: row.grant_version,
        authenticationMethods: row.authentication_methods,
        userVerified: row.user_verified,
        policyVersion: row.policy_version,
        deviceName: row.device_name,
        device: row.device,
        authenticatedAt: row.authenticated_at,
        expiresAt: row.expires_at,
        idleExpiresAt: row.idle_expires_at,
      }));
    },
    grants: async (userId) => {
      const rows = known(userId)
        ? await database
            .selectFrom('user_application_grants')
            .selectAll()
            .where('user_id', '=', userId)
            .execute()
        : [];
      return rows.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        allowed: row.allowed,
        issuanceFence: row.issuance_fence,
      }));
    },
    events: async () => {
      const rows = await database
        .selectFrom('security_events')
        .selectAll()
        .where('action', '!=', REFUSED_EVENT_SEED_ACTION)
        .execute();
      return rows.map((row) => ({
        action: row.action,
        outcome: row.outcome,
        targetUserId: row.target_user_id,
        clientId: row.client_id,
        sessionId: row.session_id,
      }));
    },

    absentAccountId: () => randomUUID(),
    foreignAccountId: () => AN_OBJECT_ID,

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
    loseCommitAnswers: (fault) => dialect.loseCommitAnswers(fault),

    reset: connection.reset,
    close: connection.close,
  };
}
