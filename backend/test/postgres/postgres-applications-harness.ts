import { randomUUID } from 'node:crypto';
import {
  ApplicationsContractHarness,
  StoredApplication,
} from '../utils/session/applications-contract/applications-contract-harness';
import { PostgresApplicationAccessStore } from '../../src/session/persistence/postgres/postgres-application-access.store';
import { PostgresApplicationRegistryStore } from '../../src/session/persistence/postgres/postgres-application-registry.store';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { bootPostgresAuthority } from './postgres-authority-harness';

const AN_OBJECT_ID = '65f000000000000000000001';

export async function bootPostgresApplicationsHarness(): Promise<ApplicationsContractHarness> {
  const { harness: authority, issuance } = await bootPostgresAuthority();
  const { database, clock } = issuance;

  return {
    authority,
    registryStore: new PostgresApplicationRegistryStore(database),
    accessStore: new PostgresApplicationAccessStore(
      database,
      clock,
      new PostgresSecurityEventStore(database),
    ),

    storedApplications: async () => {
      const rows = await database
        .selectFrom('applications')
        .selectAll()
        .orderBy('environment', 'asc')
        .orderBy('client_id', 'asc')
        .execute();
      return rows.map((row): StoredApplication => ({
        clientId: row.client_id,
        environment: row.environment,
        displayName: row.display_name,
        platform: row.platform,
        clientType: row.client_type,
        enabled: row.enabled,
        redirectUris: row.redirect_uris,
        allowedOrigins: row.allowed_origins,
        audiences: row.audiences,
        allowedScopes: row.allowed_scopes,
        absoluteLifetimeMs: Number.parseInt(row.absolute_lifetime_ms, 10),
        idleLifetimeMs: Number.parseInt(row.idle_lifetime_ms, 10),
        sessionVersion: row.session_version,
      }));
    },
    seedStoredApplication: async (application) => {
      await database
        .insertInto('applications')
        .values({
          client_id: application.clientId,
          environment: application.environment,
          display_name: application.displayName,
          platform: application.platform,
          client_type: application.clientType,
          enabled: application.enabled,
          redirect_uris: application.redirectUris,
          allowed_origins: application.allowedOrigins,
          audiences: application.audiences,
          allowed_scopes: application.allowedScopes,
          absolute_lifetime_ms: application.absoluteLifetimeMs,
          idle_lifetime_ms: application.idleLifetimeMs,
          session_version: application.sessionVersion,
        })
        .execute();
    },
    grant: async (userId, clientId) => {
      const row = await database
        .selectFrom('user_application_grants')
        .select(['id', 'allowed', 'session_version'])
        .where('user_id', '=', userId)
        .where('client_id', '=', clientId)
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            allowed: row.allowed,
            sessionVersion: row.session_version,
          }
        : null;
    },
    absentGrantId: () => randomUUID(),
    foreignGrantId: () => AN_OBJECT_ID,
  };
}
