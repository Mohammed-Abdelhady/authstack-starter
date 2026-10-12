import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { CREDENTIAL_PURPOSE } from '../../../constants/credential-purpose';
import {
  NativeRotationStore,
  REFRESH_CLAIM,
  RefreshClaim,
  REPLACEMENT_LINK,
  ReplacementLink,
  RETRY_CLAIM,
  RetryClaim,
  SESSION_KEY_BINDING,
  SessionKeyBinding,
  SUCCESSOR_LINK,
  SUCCESSOR_REVOCATION,
  SuccessorHashes,
  SuccessorLink,
  SuccessorLookup,
  SuccessorRevocation,
  UnusedSuccessor,
} from '../../credentials/native-rotation.store';
import { toUuid } from '../../../persistence/postgres/postgres-issuance-mappers';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';

/**
 * Every guard is in the statement's `WHERE` and the outcome is read from
 * `RETURNING`. The family is already taken by the read that found the token.
 */
export class PostgresNativeRotationStore extends NativeRotationStore {
  async claimRefresh(
    unitOfWork: UnitOfWork,
    credentialId: string,
    now: Date,
  ): Promise<RefreshClaim> {
    const claimed = await postgresTransactionOf(unitOfWork)
      .updateTable('native_credentials')
      .set({ spent: true, consumed_at: now })
      .where('id', '=', toUuid(credentialId))
      .where('spent', '=', false)
      .returning('id')
      .execute();
    return claimed.length === 1
      ? REFRESH_CLAIM.CLAIMED
      : REFRESH_CLAIM.ALREADY_SPENT;
  }

  async retireAccessTokens(
    unitOfWork: UnitOfWork,
    family: { familyId: string; sessionId: string; now: Date },
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('native_credentials')
      .set({ spent: true, revoked_at: family.now })
      .where('family_id', '=', family.familyId)
      .where('session_id', '=', toUuid(family.sessionId))
      .where('purpose', '=', CREDENTIAL_PURPOSE.NATIVE_ACCESS)
      .where('spent', '=', false)
      .execute();
  }

  async linkSuccessors(
    unitOfWork: UnitOfWork,
    credentialId: string,
    successors: SuccessorHashes,
  ): Promise<SuccessorLink> {
    const linked = await postgresTransactionOf(unitOfWork)
      .updateTable('native_credentials')
      .set({
        successor_access_hash: successors.accessHash,
        successor_refresh_hash: successors.refreshHash,
      })
      .where('id', '=', toUuid(credentialId))
      .where('spent', '=', true)
      .returning('id')
      .execute();
    return linked.length === 1
      ? SUCCESSOR_LINK.LINKED
      : SUCCESSOR_LINK.NOT_SPENT;
  }

  async bindSessionKey(
    unitOfWork: UnitOfWork,
    sessionId: string,
    thumbprint: string,
  ): Promise<SessionKeyBinding> {
    const bound = await postgresTransactionOf(unitOfWork)
      .updateTable('sessions')
      .set({ proof_key_thumbprint: thumbprint })
      .where('id', '=', toUuid(sessionId))
      .where('proof_key_thumbprint', 'is', null)
      .returning('id')
      .execute();
    return bound.length === 1
      ? SESSION_KEY_BINDING.BOUND
      : SESSION_KEY_BINDING.ALREADY_BOUND;
  }

  async findUnusedSuccessor(
    unitOfWork: UnitOfWork,
    spent: SuccessorLookup,
  ): Promise<UnusedSuccessor | null> {
    const transaction = postgresTransactionOf(unitOfWork);
    const sessionId = toUuid(spent.sessionId);
    const refresh = await transaction
      .selectFrom('native_credentials')
      .select(['id', 'generation'])
      .where('token_hash', '=', spent.refreshHash)
      .where('purpose', '=', CREDENTIAL_PURPOSE.NATIVE_REFRESH)
      .where('family_id', '=', spent.familyId)
      .where('session_id', '=', sessionId)
      .where('client_id', '=', spent.clientId)
      .where('generation', '=', spent.generation + 1)
      .where('spent', '=', false)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!refresh) {
      return null;
    }
    const access = await transaction
      .selectFrom('native_credentials')
      .select('id')
      .where('token_hash', '=', spent.accessHash)
      .where('purpose', '=', CREDENTIAL_PURPOSE.NATIVE_ACCESS)
      .where('family_id', '=', spent.familyId)
      .where('session_id', '=', sessionId)
      .where('client_id', '=', spent.clientId)
      .where('generation', '=', refresh.generation)
      .where('first_used_at', 'is', null)
      .where('spent', '=', false)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!access) {
      return null;
    }
    const usedGeneration = await transaction
      .selectFrom('native_credentials')
      .select('id')
      .where('family_id', '=', spent.familyId)
      .where('session_id', '=', sessionId)
      .where('generation', '=', refresh.generation)
      .where('purpose', '=', CREDENTIAL_PURPOSE.NATIVE_ACCESS)
      .where('first_used_at', 'is not', null)
      .limit(1)
      .executeTakeFirst();
    return usedGeneration
      ? null
      : {
          accessId: access.id,
          refreshId: refresh.id,
          generation: refresh.generation,
        };
  }

  async claimRetry(
    unitOfWork: UnitOfWork,
    credentialId: string,
    window: { now: Date; until: Date },
  ): Promise<RetryClaim> {
    const claimed = await postgresTransactionOf(unitOfWork)
      .updateTable('native_credentials')
      .set({ retry_claim_until: window.until })
      .where('id', '=', toUuid(credentialId))
      .where('spent', '=', true)
      .where('revoked_at', 'is', null)
      .where((guard) =>
        guard.or([
          guard('retry_claim_until', 'is', null),
          guard('retry_claim_until', '<=', window.now),
        ]),
      )
      .returning('id')
      .execute();
    return claimed.length === 1 ? RETRY_CLAIM.CLAIMED : RETRY_CLAIM.IN_PROGRESS;
  }

  async revokeUnusedSuccessor(
    unitOfWork: UnitOfWork,
    successor: { accessId: string; refreshId: string; now: Date },
  ): Promise<SuccessorRevocation> {
    const transaction = postgresTransactionOf(unitOfWork);
    const refresh = await transaction
      .updateTable('native_credentials')
      .set({ spent: true, revoked_at: successor.now })
      .where('id', '=', toUuid(successor.refreshId))
      .where('spent', '=', false)
      .where('revoked_at', 'is', null)
      .returning('id')
      .execute();
    const access = await transaction
      .updateTable('native_credentials')
      .set({ spent: true, revoked_at: successor.now })
      .where('id', '=', toUuid(successor.accessId))
      .where('spent', '=', false)
      .where('revoked_at', 'is', null)
      .where('first_used_at', 'is', null)
      .returning('id')
      .execute();
    return refresh.length === 1 && access.length === 1
      ? SUCCESSOR_REVOCATION.REVOKED
      : SUCCESSOR_REVOCATION.ALREADY_USED;
  }

  async linkReplacement(
    unitOfWork: UnitOfWork,
    credentialId: string,
    replacement: SuccessorHashes & { now: Date },
  ): Promise<ReplacementLink> {
    const linked = await postgresTransactionOf(unitOfWork)
      .updateTable('native_credentials')
      .set({
        successor_access_hash: replacement.accessHash,
        successor_refresh_hash: replacement.refreshHash,
      })
      .where('id', '=', toUuid(credentialId))
      .where('retry_claim_until', '>', replacement.now)
      .returning('id')
      .execute();
    return linked.length === 1
      ? REPLACEMENT_LINK.LINKED
      : REPLACEMENT_LINK.CLAIM_LAPSED;
  }
}
