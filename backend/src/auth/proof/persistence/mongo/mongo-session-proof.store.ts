import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
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
import { SessionProof, SessionProofDocument } from './session-proof.schema';

function scope(ref: ProofSessionRef) {
  return { _id: ref.sessionId, userId: ref.userId, clientId: ref.clientId };
}

@Injectable()
export class MongoSessionProofStore extends SessionProofStore {
  constructor(
    @InjectModel(SessionProof.name)
    private readonly proofs: Model<SessionProofDocument>,
  ) {
    super();
  }

  async openChallenge(
    uow: UnitOfWork,
    input: OpenProofChallenge,
  ): Promise<void> {
    await this.upsert(uow, input, {
      $set: {
        challengeKind: input.kind,
        challengeHash: input.challengeHash,
        challengeExpiresAt: input.expiresAt,
        challengeWrongGuesses: 0,
      },
      $max: { purgeAfter: input.purgeAfter },
    });
  }

  async takeChallenge(
    uow: UnitOfWork,
    ref: ProofSessionRef,
    kind: ProofKind,
  ): Promise<StoredProofChallenge | null> {
    const row = await this.proofs
      .findOneAndUpdate(
        { ...scope(ref), challengeKind: kind },
        { $inc: { lockVersion: 1 } },
        { session: mongoSessionOf(uow), returnDocument: 'after' },
      )
      .exec();
    if (
      !row ||
      row.challengeKind === null ||
      row.challengeHash === null ||
      row.challengeExpiresAt === null
    ) {
      return null;
    }
    return {
      kind: row.challengeKind,
      challengeHash: row.challengeHash,
      expiresAt: row.challengeExpiresAt,
      wrongGuesses: row.challengeWrongGuesses,
    };
  }

  async recordWrongGuess(
    uow: UnitOfWork,
    ref: ProofSessionRef,
    limit: number,
  ): Promise<number> {
    const session = mongoSessionOf(uow);
    const row = await this.proofs
      .findOneAndUpdate(
        { ...scope(ref), challengeKind: { $ne: null } },
        { $inc: { challengeWrongGuesses: 1 } },
        { session, returnDocument: 'after' },
      )
      .exec();
    if (!row) return 0;
    if (row.challengeWrongGuesses >= limit) {
      await this.proofs
        .updateOne(
          scope(ref),
          {
            $set: {
              challengeKind: null,
              challengeHash: null,
              challengeExpiresAt: null,
            },
          },
          { session },
        )
        .exec();
    }
    return row.challengeWrongGuesses;
  }

  async recordProof(uow: UnitOfWork, input: RecordedProof): Promise<void> {
    await this.upsert(uow, input, {
      $set: {
        challengeKind: null,
        challengeHash: null,
        challengeExpiresAt: null,
        challengeWrongGuesses: 0,
        proofKind: input.kind,
        proofRpId: input.rpId ?? null,
        proofUserVerified: input.userVerified,
        provedAt: input.provedAt,
        purgeAfter: input.purgeAfter,
      },
    });
  }

  async readProof(
    uow: UnitOfWork,
    ref: ProofSessionRef,
  ): Promise<FreshProofAct | null> {
    const row = await this.proofs
      .findOne(scope(ref))
      .session(mongoSessionOf(uow))
      .lean()
      .exec();
    return row
      ? storedProofAct(
          ref,
          row.proofKind,
          row.proofRpId,
          row.proofUserVerified,
          row.provedAt,
        )
      : null;
  }

  private async upsert(
    uow: UnitOfWork,
    ref: ProofSessionRef,
    update: UpdateQuery<SessionProofDocument>,
  ): Promise<void> {
    await this.proofs
      .findOneAndUpdate(scope(ref), update, {
        upsert: true,
        session: mongoSessionOf(uow),
      })
      .exec();
  }
}
