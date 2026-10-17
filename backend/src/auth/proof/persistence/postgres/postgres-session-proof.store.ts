import { sql } from 'kysely';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { FreshProofAct } from '../../../contracts/types/fresh-proof';
import { SessionProofStore } from '../../stores/session-proof.store';
import {
  OpenProofChallenge,
  ProofKind,
  ProofSessionRef,
  RecordedProof,
  StoredProofChallenge,
} from '../../types/session-proof';
import { storedProofAct } from '../stored-proof-act';

export class PostgresSessionProofStore extends SessionProofStore {
  async openChallenge(
    uow: UnitOfWork,
    input: OpenProofChallenge,
  ): Promise<void> {
    const challenge = {
      challenge_kind: input.kind,
      challenge_hash: input.challengeHash,
      challenge_expires_at: input.expiresAt,
      challenge_wrong_guesses: 0,
    };
    await postgresTransactionOf(uow)
      .insertInto('session_proofs')
      .values({
        session_id: input.sessionId,
        user_id: input.userId,
        client_id: input.clientId,
        ...challenge,
        proof_kind: null,
        proof_rp_id: null,
        purge_after: input.purgeAfter,
      })
      .onConflict((conflict) =>
        conflict
          .column('session_id')
          .doUpdateSet({
            ...challenge,
            purge_after: sql<Date>`greatest(session_proofs.purge_after, ${input.purgeAfter})`,
          })
          .where('session_proofs.user_id', '=', input.userId)
          .where('session_proofs.client_id', '=', input.clientId),
      )
      .execute();
  }

  async takeChallenge(
    uow: UnitOfWork,
    ref: ProofSessionRef,
    kind: ProofKind,
  ): Promise<StoredProofChallenge | null> {
    const row = await postgresTransactionOf(uow)
      .selectFrom('session_proofs')
      .selectAll()
      .where('session_id', '=', ref.sessionId)
      .where('user_id', '=', ref.userId)
      .where('client_id', '=', ref.clientId)
      .where('challenge_kind', '=', kind)
      .forUpdate()
      .executeTakeFirst();
    if (
      !row ||
      row.challenge_kind === null ||
      row.challenge_hash === null ||
      row.challenge_expires_at === null
    ) {
      return null;
    }
    return {
      kind: row.challenge_kind,
      challengeHash: row.challenge_hash,
      expiresAt: row.challenge_expires_at,
      wrongGuesses: row.challenge_wrong_guesses,
    };
  }

  async recordWrongGuess(
    uow: UnitOfWork,
    ref: ProofSessionRef,
    limit: number,
  ): Promise<number> {
    const row = await postgresTransactionOf(uow)
      .updateTable('session_proofs')
      .set({
        challenge_wrong_guesses: sql<number>`challenge_wrong_guesses + 1`,
        challenge_kind: sql<ProofKind | null>`case when challenge_wrong_guesses + 1 >= ${limit} then null else challenge_kind end`,
        challenge_hash: sql<
          string | null
        >`case when challenge_wrong_guesses + 1 >= ${limit} then null else challenge_hash end`,
        challenge_expires_at: sql<Date | null>`case when challenge_wrong_guesses + 1 >= ${limit} then null else challenge_expires_at end`,
      })
      .where('session_id', '=', ref.sessionId)
      .where('user_id', '=', ref.userId)
      .where('client_id', '=', ref.clientId)
      .where('challenge_kind', 'is not', null)
      .returning('challenge_wrong_guesses')
      .executeTakeFirst();
    return row?.challenge_wrong_guesses ?? 0;
  }

  async recordProof(uow: UnitOfWork, input: RecordedProof): Promise<void> {
    const proof = {
      challenge_kind: null,
      challenge_hash: null,
      challenge_expires_at: null,
      challenge_wrong_guesses: 0,
      proof_kind: input.kind,
      proof_rp_id: input.rpId ?? null,
      proof_user_verified: input.userVerified,
      proved_at: input.provedAt,
      purge_after: input.purgeAfter,
    };
    await postgresTransactionOf(uow)
      .insertInto('session_proofs')
      .values({
        session_id: input.sessionId,
        user_id: input.userId,
        client_id: input.clientId,
        ...proof,
      })
      .onConflict((conflict) =>
        conflict
          .column('session_id')
          .doUpdateSet(proof)
          .where('session_proofs.user_id', '=', input.userId)
          .where('session_proofs.client_id', '=', input.clientId),
      )
      .execute();
  }

  async readProof(
    uow: UnitOfWork,
    ref: ProofSessionRef,
  ): Promise<FreshProofAct | null> {
    const row = await postgresTransactionOf(uow)
      .selectFrom('session_proofs')
      .selectAll()
      .where('session_id', '=', ref.sessionId)
      .where('user_id', '=', ref.userId)
      .where('client_id', '=', ref.clientId)
      .executeTakeFirst();
    return row
      ? storedProofAct(
          ref,
          row.proof_kind,
          row.proof_rp_id,
          row.proof_user_verified,
          row.proved_at,
        )
      : null;
  }
}
