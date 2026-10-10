import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AuthEpochService } from '../../src/common/services/auth-epoch.service';
import { SessionValidator } from '../../src/session/authority/session-validator';
import { SessionRevoker } from '../../src/session/revocation/session-revoker';
import { REFUSED_EVENT_SEED_ACTION } from '../utils/refused-event';
import {
  ACCOUNT_TAKEN_AT,
  AuthorityContractHarness,
} from '../utils/session/authority-contract/authority-contract-harness';
import {
  CONTRACT_AUTH_EPOCH,
  CONTRACT_ENVIRONMENT,
} from '../utils/session/issuance-contract/issuance-contract-harness';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { PostgresApplicationRegistryStore } from '../../src/session/persistence/postgres/postgres-application-registry.store';
import { PostgresAuthorityApplications } from '../../src/session/persistence/postgres/postgres-authority-applications';
import { PostgresIdFormat } from '../../src/common/persistence/postgres/postgres-id-format';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresSessionAuthorityStore } from '../../src/session/persistence/postgres/postgres-session-authority.store';
import { PostgresSessionRevocationStore } from '../../src/session/persistence/postgres/postgres-session-revocation.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import {
  bootPostgresIssuanceHarness,
  PostgresIssuanceHarness,
} from './postgres-issuance-harness';

const AN_OBJECT_ID = '65f000000000000000000001';

export interface PostgresAuthorityBoot {
  harness: AuthorityContractHarness;
  /** The same database, for a contract that needs more of it. */
  issuance: PostgresIssuanceHarness;
}

export async function bootPostgresAuthorityHarness(): Promise<AuthorityContractHarness> {
  return (await bootPostgresAuthority()).harness;
}

export async function bootPostgresAuthority(): Promise<PostgresAuthorityBoot> {
  const issuance = await bootPostgresIssuanceHarness();
  const { database, clock } = issuance;
  const authorityStore = new PostgresSessionAuthorityStore(database);
  const revocationStore = new PostgresSessionRevocationStore(
    clock,
    new PostgresSecurityEventStore(database),
  );
  const authEpoch = new AuthEpochService(
    new ConfigService({
      auth: { epoch: CONTRACT_AUTH_EPOCH, nativeEnabled: false },
      server: { nodeEnv: CONTRACT_ENVIRONMENT },
    }),
  );
  const authorityApplications = new PostgresAuthorityApplications(
    new ApplicationRegistry(
      new PostgresUnitOfWorkRunner(database),
      new PostgresApplicationRegistryStore(database),
      authEpoch,
    ),
  );

  const harness: AuthorityContractHarness = {
    issuance,
    accountTakenAt: ACCOUNT_TAKEN_AT.FIRST_READ,
    authorityStore,
    authorityApplications,
    revocationStore,
    validator: () =>
      new SessionValidator(
        authorityStore,
        authorityApplications,
        clock,
        authEpoch,
      ),
    revoker: (pause) =>
      new SessionRevoker(
        new PostgresUnitOfWorkRunner(database, pause),
        revocationStore,
        clock,
      ),

    session: async (sessionId) => {
      const row = await database
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();
      return row
        ? {
            isValid: row.is_valid,
            revokedAt: row.revoked_at,
            revokedReason: row.revoked_reason,
            userVersion: row.user_version,
            idleExpiresAt: row.idle_expires_at,
            lastActivityAt: row.last_activity_at,
            lastUsedAt: row.last_used_at,
          }
        : null;
    },
    patchSession: async (sessionId, patch) => {
      await database
        .updateTable('sessions')
        .set({
          credential_purpose: patch.credentialPurpose,
          auth_epoch: patch.authEpoch,
          schema_version: patch.schemaVersion,
          user_version: patch.userVersion,
          client_version: patch.clientVersion,
          grant_version: patch.grantVersion,
          expires_at: patch.expiresAt,
          idle_expires_at: patch.idleExpiresAt,
          last_activity_at: patch.lastActivityAt,
          last_used_at: patch.lastUsedAt,
        })
        .where('id', '=', sessionId)
        .execute();
    },
    patchGrant: async (userId, clientId, patch) => {
      await database
        .updateTable('user_application_grants')
        .set({ allowed: patch.allowed, session_version: patch.sessionVersion })
        .where('user_id', '=', userId)
        .where('client_id', '=', clientId)
        .execute();
    },
    removeGrant: async (userId, clientId) => {
      await database
        .deleteFrom('user_application_grants')
        .where('user_id', '=', userId)
        .where('client_id', '=', clientId)
        .execute();
    },
    markAccountDeleted: async (userId) => {
      await database
        .updateTable('users')
        .set({ is_deleted: true })
        .where('id', '=', userId)
        .execute();
    },
    setAccountIdentity: async (userId, identity) => {
      await database
        .updateTable('users')
        .set({
          email: identity.email,
          name: identity.name,
          role: identity.role,
          permissions: identity.permissions,
          is_verified: identity.verified,
        })
        .where('id', '=', userId)
        .execute();
    },
    events: async () => {
      const rows = await database
        .selectFrom('security_events')
        .selectAll()
        .where('action', '!=', REFUSED_EVENT_SEED_ACTION)
        .orderBy('id', 'asc')
        .execute();
      return rows.map((row) => ({
        action: row.action,
        actorId: row.actor_id,
        targetUserId: row.target_user_id,
        clientId: row.client_id,
        sessionId: row.session_id,
        reasonCode: row.reason_code,
      }));
    },
    absentSessionId: () => randomUUID(),
    ids: new PostgresIdFormat(),
    foreignSessionId: () => AN_OBJECT_ID,
  };
  return { harness, issuance };
}
