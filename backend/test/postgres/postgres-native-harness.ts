import { randomUUID } from 'node:crypto';
import { AuthEpochService } from '../../src/common/services/auth-epoch.service';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { SecurityEventRecorder } from '../../src/session/events/security-event-recorder';
import { REFUSED_EVENT_SEED_ACTION } from '../utils/refused-event';
import {
  NativeContractHarness,
  SEES_COMMITS,
  TAKEN_AT,
} from '../utils/native/contract/native-contract-harness';
import {
  buildNativeServices,
  nativeConfig,
} from '../utils/native/contract/native-contract-services';
import {
  NATIVE_APPLICATION,
  NATIVE_CLIENT,
  NATIVE_DISPLAY_NAME,
} from '../utils/native/contract/native-contract-support';
import { CONTRACT_ENVIRONMENT } from '../utils/session/issuance-contract/issuance-contract-harness';
import { rerunAtOnce } from '../utils/session/issuance-contract/issuance-contract-support';
import { PostgresApplicationAccessStore } from '../../src/session/persistence/postgres/postgres-application-access.store';
import { PostgresApplicationRegistryStore } from '../../src/session/persistence/postgres/postgres-application-registry.store';
import { PostgresAuthorityApplications } from '../../src/session/persistence/postgres/postgres-authority-applications';
import { PostgresNativeAccessStore } from '../../src/session/native/persistence/postgres/postgres-native-access.store';
import { PostgresNativeAuthorizationStore } from '../../src/session/native/persistence/postgres/postgres-native-authorization.store';
import { PostgresNativeCredentialStore } from '../../src/session/native/persistence/postgres/postgres-native-credential.store';
import { PostgresNativeRotationStore } from '../../src/session/native/persistence/postgres/postgres-native-rotation.store';
import { PostgresNativeSecurityEvents } from '../../src/session/native/persistence/postgres/postgres-native-security-events';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresSessionAuthorityStore } from '../../src/session/persistence/postgres/postgres-session-authority.store';
import { PostgresSessionRevocationStore } from '../../src/session/persistence/postgres/postgres-session-revocation.store';
import { bootPostgresIssuanceHarness } from './postgres-issuance-harness';

const AN_OBJECT_ID = '65f000000000000000000001';

export async function bootPostgresNativeHarness(): Promise<NativeContractHarness> {
  const issuance = await bootPostgresIssuanceHarness();
  const { database, clock } = issuance;
  const eventStore = new PostgresSecurityEventStore(database);
  const stores = {
    authorizations: new PostgresNativeAuthorizationStore(database),
    registry: new PostgresApplicationRegistryStore(database),
    grants: new PostgresApplicationAccessStore(database, clock, eventStore),
    credentials: new PostgresNativeCredentialStore(),
    rotations: new PostgresNativeRotationStore(),
    access: new PostgresNativeAccessStore(database),
    events: new PostgresNativeSecurityEvents(
      new SecurityEventRecorder(eventStore, clock),
    ),
  };
  const revocationStore = new PostgresSessionRevocationStore(clock, eventStore);
  const authorityStore = new PostgresSessionAuthorityStore(database);
  const authorityApplications = new PostgresAuthorityApplications(
    new ApplicationRegistry(
      issuance.runner(rerunAtOnce),
      stores.registry,
      new AuthEpochService(nativeConfig({})),
    ),
  );

  return {
    issuance,
    takenAt: TAKEN_AT.FIRST_READ,
    seesCommits: SEES_COMMITS.UNTIL_EACH_STATEMENT,
    stores,
    services: (options = {}) =>
      buildNativeServices(
        {
          runner: issuance.runner(options.pause ?? rerunAtOnce),
          clock,
          stores,
          issuanceStore: issuance.store,
          issuanceApplications: issuance.applications,
          revocationStore,
          authorityStore,
          authorityApplications,
        },
        options,
      ),

    seedNativeApplication: async (patch = {}) => {
      const seed = { ...NATIVE_APPLICATION, ...patch };
      const values = {
        platform: seed.platform,
        enabled: seed.enabled,
        session_version: seed.sessionVersion,
        allowed_scopes: ['api'],
        absolute_lifetime_ms: NATIVE_APPLICATION.absoluteLifetimeMs,
        idle_lifetime_ms: NATIVE_APPLICATION.idleLifetimeMs,
        client_type: seed.clientType,
        redirect_uris: seed.redirectUris,
        display_name: NATIVE_DISPLAY_NAME,
      };
      await database
        .insertInto('applications')
        .values({
          client_id: NATIVE_CLIENT,
          environment: CONTRACT_ENVIRONMENT,
          ...values,
        })
        .onConflict((conflict) =>
          conflict.columns(['client_id', 'environment']).doUpdateSet(values),
        )
        .execute();
    },
    authorization: async (transactionId) => {
      const row = await database
        .selectFrom('authorization_transactions')
        .selectAll()
        .where('transaction_id', '=', transactionId)
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            consumed: row.consumed,
            codeHash: row.code_hash,
            expiresAt: row.expires_at,
            codeExpiresAt: row.code_expires_at,
            userId: row.user_id,
            state: row.state,
            requestedScopes: row.requested_scopes,
            authEpoch: row.auth_epoch,
            authenticationMethods: row.authentication_methods,
            capturedUserVersion: row.captured_user_version,
            capturedClientVersion: row.captured_client_version,
            capturedGrantVersion: row.captured_grant_version,
          }
        : null;
    },
    credentialsOf: async (sessionId) => {
      const rows = await database
        .selectFrom('native_credentials')
        .selectAll()
        .where('session_id', '=', sessionId)
        .orderBy('generation', 'asc')
        .orderBy('purpose', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map((row) => ({
        id: row.id,
        tokenHash: row.token_hash,
        purpose: row.purpose,
        generation: row.generation,
        familyId: row.family_id,
        expiresAt: row.expires_at,
        spent: row.spent,
        consumedAt: row.consumed_at,
        revokedAt: row.revoked_at,
        firstUsedAt: row.first_used_at,
        proofKeyThumbprint: row.proof_key_thumbprint,
        successorAccessHash: row.successor_access_hash,
        successorRefreshHash: row.successor_refresh_hash,
        retryClaimUntil: row.retry_claim_until,
      }));
    },
    patchCredential: async (tokenHash, patch) => {
      await database
        .updateTable('native_credentials')
        .set({
          expires_at: patch.expiresAt,
          consumed_at: patch.consumedAt,
          retry_claim_until: patch.retryClaimUntil,
        })
        .where('token_hash', '=', tokenHash)
        .execute();
    },
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
            credentialPurpose: row.credential_purpose,
            proofKeyThumbprint: row.proof_key_thumbprint,
            userVersion: row.user_version,
            clientVersion: row.client_version,
            grantVersion: row.grant_version,
            scopes: row.scopes,
            authenticationMethods: row.authentication_methods,
            expiresAt: row.expires_at,
            idleExpiresAt: row.idle_expires_at,
          }
        : null;
    },
    revokeSession: async (sessionId) => {
      await database
        .updateTable('sessions')
        .set({ is_valid: false, revoked_at: clock.now() })
        .where('id', '=', sessionId)
        .execute();
    },
    patchGrant: async (userId, patch) => {
      await database
        .updateTable('user_application_grants')
        .set({ allowed: patch.allowed, session_version: patch.sessionVersion })
        .where('user_id', '=', userId)
        .where('client_id', '=', NATIVE_CLIENT)
        .execute();
    },
    removeGrant: async (userId) => {
      await database
        .deleteFrom('user_application_grants')
        .where('user_id', '=', userId)
        .where('client_id', '=', NATIVE_CLIENT)
        .execute();
    },
    markAccountDeleted: async (userId) => {
      await database
        .updateTable('users')
        .set({ is_deleted: true })
        .where('id', '=', userId)
        .execute();
    },
    storedProofIds: async () => {
      const counted = await database
        .selectFrom('native_dpop_proof_ids')
        .select((row) => row.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow();
      return Number.parseInt(counted.total, 10);
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
        targetUserId: row.target_user_id,
        clientId: row.client_id,
        sessionId: row.session_id,
        reasonCode: row.reason_code,
        outcome: row.outcome,
      }));
    },
    absentId: () => randomUUID(),
    foreignId: () => AN_OBJECT_ID,
    reset: () => issuance.reset(),
  };
}
