import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { CREDENTIAL_PURPOSE } from '../../../constants/credential-purpose';
import { toObjectId } from '../../../persistence/mongo/mongo-issuance-mappers';
import { mongoSessionOf } from '../../../persistence/mongo/mongo-unit-of-work';
import {
  NativeCredential,
  NativeCredentialDocument,
} from '../../../persistence/mongo/schemas/native-credential.schema';
import {
  Session,
  SessionDocument,
} from '../../../persistence/mongo/schemas/session.schema';
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

const NEVER_SET = { $exists: false } as const;

/**
 * Each outcome is read from `matchedCount` on a filter that holds the guard.
 * The driver's own error leaves as raised, for the runner to map.
 */
@Injectable()
export class MongoNativeRotationStore extends NativeRotationStore {
  constructor(
    @InjectModel(NativeCredential.name)
    private readonly credentials: Model<NativeCredentialDocument>,
    @InjectModel(Session.name)
    private readonly sessions: Model<SessionDocument>,
  ) {
    super();
  }

  async claimRefresh(
    unitOfWork: UnitOfWork,
    credentialId: string,
    now: Date,
  ): Promise<RefreshClaim> {
    const claimed = await this.credentials
      .updateOne(
        { _id: toObjectId(credentialId), spent: false },
        { $set: { spent: true, consumedAt: now } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return claimed.matchedCount === 1
      ? REFRESH_CLAIM.CLAIMED
      : REFRESH_CLAIM.ALREADY_SPENT;
  }

  async retireAccessTokens(
    unitOfWork: UnitOfWork,
    family: { familyId: string; sessionId: string; now: Date },
  ): Promise<void> {
    await this.credentials
      .updateMany(
        {
          familyId: family.familyId,
          sessionId: toObjectId(family.sessionId),
          purpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
          spent: false,
        },
        { $set: { spent: true, revokedAt: family.now } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  async linkSuccessors(
    unitOfWork: UnitOfWork,
    credentialId: string,
    successors: SuccessorHashes,
  ): Promise<SuccessorLink> {
    const linked = await this.credentials
      .updateOne(
        { _id: toObjectId(credentialId), spent: true },
        {
          $set: {
            successorAccessHash: successors.accessHash,
            successorRefreshHash: successors.refreshHash,
          },
        },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return linked.matchedCount === 1
      ? SUCCESSOR_LINK.LINKED
      : SUCCESSOR_LINK.NOT_SPENT;
  }

  async bindSessionKey(
    unitOfWork: UnitOfWork,
    sessionId: string,
    thumbprint: string,
  ): Promise<SessionKeyBinding> {
    const bound = await this.sessions
      .updateOne(
        { _id: toObjectId(sessionId), proofKeyThumbprint: NEVER_SET },
        { $set: { proofKeyThumbprint: thumbprint } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return bound.matchedCount === 1
      ? SESSION_KEY_BINDING.BOUND
      : SESSION_KEY_BINDING.ALREADY_BOUND;
  }

  async findUnusedSuccessor(
    unitOfWork: UnitOfWork,
    spent: SuccessorLookup,
  ): Promise<UnusedSuccessor | null> {
    const db = mongoSessionOf(unitOfWork);
    const family = {
      familyId: spent.familyId,
      sessionId: toObjectId(spent.sessionId),
    };
    const refresh = await this.credentials
      .findOne({
        tokenHash: spent.refreshHash,
        purpose: CREDENTIAL_PURPOSE.NATIVE_REFRESH,
        ...family,
        clientId: spent.clientId,
        generation: spent.generation + 1,
        spent: false,
        revokedAt: NEVER_SET,
      })
      .session(db)
      .exec();
    if (!refresh) {
      return null;
    }
    const access = await this.credentials
      .findOne({
        tokenHash: spent.accessHash,
        purpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        ...family,
        clientId: spent.clientId,
        generation: refresh.generation,
        firstUsedAt: NEVER_SET,
        spent: false,
        revokedAt: NEVER_SET,
      })
      .session(db)
      .exec();
    if (!access) {
      return null;
    }
    const usedGeneration = await this.credentials
      .findOne({
        ...family,
        generation: refresh.generation,
        purpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        firstUsedAt: { $exists: true },
      })
      .session(db)
      .exec();
    return usedGeneration
      ? null
      : {
          accessId: access._id.toString(),
          refreshId: refresh._id.toString(),
          generation: refresh.generation,
        };
  }

  async claimRetry(
    unitOfWork: UnitOfWork,
    credentialId: string,
    window: { now: Date; until: Date },
  ): Promise<RetryClaim> {
    const claimed = await this.credentials
      .updateOne(
        {
          _id: toObjectId(credentialId),
          spent: true,
          revokedAt: NEVER_SET,
          $or: [
            { retryClaimUntil: NEVER_SET },
            { retryClaimUntil: { $lte: window.now } },
          ],
        },
        { $set: { retryClaimUntil: window.until } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return claimed.matchedCount === 1
      ? RETRY_CLAIM.CLAIMED
      : RETRY_CLAIM.IN_PROGRESS;
  }

  async revokeUnusedSuccessor(
    unitOfWork: UnitOfWork,
    successor: { accessId: string; refreshId: string; now: Date },
  ): Promise<SuccessorRevocation> {
    const db = mongoSessionOf(unitOfWork);
    const ended = { $set: { spent: true, revokedAt: successor.now } };
    const refresh = await this.credentials
      .updateOne(
        {
          _id: toObjectId(successor.refreshId),
          spent: false,
          revokedAt: NEVER_SET,
        },
        ended,
      )
      .session(db)
      .exec();
    const access = await this.credentials
      .updateOne(
        {
          _id: toObjectId(successor.accessId),
          spent: false,
          revokedAt: NEVER_SET,
          firstUsedAt: NEVER_SET,
        },
        ended,
      )
      .session(db)
      .exec();
    return refresh.matchedCount === 1 && access.matchedCount === 1
      ? SUCCESSOR_REVOCATION.REVOKED
      : SUCCESSOR_REVOCATION.ALREADY_USED;
  }

  async linkReplacement(
    unitOfWork: UnitOfWork,
    credentialId: string,
    replacement: SuccessorHashes & { now: Date },
  ): Promise<ReplacementLink> {
    const linked = await this.credentials
      .updateOne(
        {
          _id: toObjectId(credentialId),
          retryClaimUntil: { $gt: replacement.now },
        },
        {
          $set: {
            successorAccessHash: replacement.accessHash,
            successorRefreshHash: replacement.refreshHash,
          },
        },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return linked.matchedCount === 1
      ? REPLACEMENT_LINK.LINKED
      : REPLACEMENT_LINK.CLAIM_LAPSED;
  }
}
