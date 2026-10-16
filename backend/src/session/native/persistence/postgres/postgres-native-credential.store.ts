import { Selectable } from 'kysely';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { deviceLabelOf } from '../../../issuance/browser-issuance.store';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../../constants/credential-purpose';
import {
  EndedFamilyOwner,
  FamilyRevocation,
  NativeCredentialStore,
  NativeFamilySession,
  NativeSessionOfAccount,
  NewCredentialPair,
  NewNativeSession,
  StoredNativeCredential,
} from '../../credentials/native-credential.store';
import {
  NativeCredentialsTable,
  SessionsTable,
} from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../persistence/postgres/postgres-issuance-mappers';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';

const PURPOSES: readonly CredentialPurpose[] =
  Object.values(CREDENTIAL_PURPOSE);

function toPurpose(stored: string): CredentialPurpose {
  const purpose = PURPOSES.find((known) => known === stored);
  if (!purpose) {
    throw new Error('A stored row has an unknown credential purpose');
  }
  return purpose;
}

function toStoredCredential(
  row: Selectable<NativeCredentialsTable>,
): StoredNativeCredential {
  return {
    id: row.id,
    purpose: toPurpose(row.purpose),
    sessionId: row.session_id,
    clientId: row.client_id,
    generation: row.generation,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    spent: row.spent,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
    proofKeyThumbprint: row.proof_key_thumbprint,
    successorAccessHash: row.successor_access_hash,
    successorRefreshHash: row.successor_refresh_hash,
  };
}

function toFamilySession(row: Selectable<SessionsTable>): NativeFamilySession {
  return {
    id: row.id,
    userId: row.user_id,
    scopes: row.scopes,
    audience: row.audience,
    authenticationMethods: row.authentication_methods,
    proofKeyThumbprint: row.proof_key_thumbprint,
    isValid: row.is_valid,
    revokedAt: row.revoked_at,
    credentialPurpose: toPurpose(row.credential_purpose),
    authEpoch: row.auth_epoch,
    schemaVersion: row.schema_version,
    clientId: row.client_id,
    userVersion: row.user_version,
    clientVersion: row.client_version,
    grantVersion: row.grant_version,
    policyVersion: row.policy_version,
    authenticatedAt: row.authenticated_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
    lastActivityAt: row.last_activity_at,
  };
}

/**
 * Takes the family at `findPresentedCredential`: the family's session row is
 * locked before the token is read, with the lock a sign-out takes on it. A
 * second unit of work is refused there at once (`NOWAIT`), which the runner
 * reports as a retryable abort, so no unit of work acts on a token it read
 * before another one changed the family. `findSessionOfAccount` takes the same
 * lock. No statement here waits for another unit of work.
 */
export class PostgresNativeCredentialStore extends NativeCredentialStore {
  async findPresentedCredential(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<StoredNativeCredential | null> {
    const transaction = postgresTransactionOf(unitOfWork);
    await transaction
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', (family) =>
        family
          .selectFrom('native_credentials')
          .select('session_id')
          .where('token_hash', '=', tokenHash),
      )
      .forNoKeyUpdate()
      .noWait()
      .execute();
    const row = await transaction
      .selectFrom('native_credentials')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row ? toStoredCredential(row) : null;
  }

  async findFamilySession(
    unitOfWork: UnitOfWork,
    sessionId: string,
  ): Promise<NativeFamilySession | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', toUuid(sessionId))
      .executeTakeFirst();
    return row ? toFamilySession(row) : null;
  }

  async insertNativeSession(
    unitOfWork: UnitOfWork,
    session: NewNativeSession,
  ): Promise<string> {
    const row = await postgresTransactionOf(unitOfWork)
      .insertInto('sessions')
      .values({
        user_id: toUuid(session.userId),
        token_hash: Buffer.from(session.tokenHash, 'hex'),
        csrf_token: null,
        user_agent: session.userAgent,
        device: JSON.stringify(deviceLabelOf(session.device)),
        device_name: session.deviceName ?? null,
        ip: session.ip,
        is_valid: true,
        client_id: session.clientId,
        user_version: session.userVersion,
        client_version: session.clientVersion,
        grant_version: session.grantVersion,
        policy_version: session.policyVersion,
        auth_epoch: session.authEpoch,
        schema_version: session.schemaVersion,
        scopes: session.scopes,
        audience: session.audience,
        authentication_methods: session.authenticationMethods,
        user_verified: session.userVerified,
        credential_purpose: session.credentialPurpose,
        browser_generation: 0,
        authenticated_at: session.authenticatedAt,
        last_used_at: session.lastUsedAt,
        last_activity_at: session.lastActivityAt,
        expires_at: session.expiresAt,
        idle_expires_at: session.idleExpiresAt,
        proof_key_thumbprint: session.proofKeyThumbprint ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async insertCredentialPair(
    unitOfWork: UnitOfWork,
    pair: NewCredentialPair,
  ): Promise<void> {
    const shared = {
      session_id: toUuid(pair.sessionId),
      client_id: pair.clientId,
      generation: pair.generation,
      family_id: pair.familyId,
      issued_at: pair.issuedAt,
      spent: false,
      proof_key_thumbprint: pair.proofKeyThumbprint ?? null,
    };
    await postgresTransactionOf(unitOfWork)
      .insertInto('native_credentials')
      .values([
        {
          ...shared,
          token_hash: pair.access.tokenHash,
          purpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
          expires_at: pair.access.expiresAt,
        },
        {
          ...shared,
          token_hash: pair.refresh.tokenHash,
          purpose: CREDENTIAL_PURPOSE.NATIVE_REFRESH,
          expires_at: pair.refresh.expiresAt,
        },
      ])
      .execute();
  }

  async revokeFamily(
    unitOfWork: UnitOfWork,
    revocation: FamilyRevocation,
  ): Promise<EndedFamilyOwner | null> {
    const transaction = postgresTransactionOf(unitOfWork);
    const sessionId = toUuid(revocation.sessionId);
    const session = await transaction
      .updateTable('sessions')
      .set({
        is_valid: false,
        revoked_at: revocation.now,
        revoked_reason: revocation.reason,
      })
      .where('id', '=', sessionId)
      .returning(['user_id', 'client_id'])
      .executeTakeFirst();
    await transaction
      .updateTable('native_credentials')
      .set({ spent: true, revoked_at: revocation.now })
      .where('family_id', '=', revocation.familyId)
      .where('session_id', '=', sessionId)
      .execute();
    return session
      ? { userId: session.user_id, clientId: session.client_id }
      : null;
  }

  async reserveProofId(
    unitOfWork: UnitOfWork,
    proofIdHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .insertInto('native_dpop_proof_ids')
      .values({ proof_id_hash: proofIdHash, expires_at: expiresAt })
      .execute();
  }

  async findSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<NativeSessionOfAccount | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions')
      .select([
        'id',
        'client_id',
        'is_valid',
        'revoked_at',
        'credential_purpose',
      ])
      .where('id', '=', toUuid(sessionId))
      .where('user_id', '=', toUuid(userId))
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          clientId: row.client_id,
          isValid: row.is_valid,
          revoked: row.revoked_at !== null,
          credentialPurpose: toPurpose(row.credential_purpose),
        }
      : null;
  }

  async revokeSessionCredentials(
    unitOfWork: UnitOfWork,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('native_credentials')
      .set({ spent: true, revoked_at: now })
      .where('session_id', '=', toUuid(sessionId))
      .execute();
  }
}
