import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { RecordSecurityEventInput } from '../../events/security-event-recorder';
import {
  ACCOUNT_VERSION_ADVANCE,
  AccountVersionAdvance,
  LiveSessionCount,
  RevocableSession,
  RevocationAccount,
  SESSION_REVOCATION,
  SessionRevocationMark,
  SessionRevocationOutcome,
  SessionRevocationStore,
  SURVIVOR_PROMOTION,
  SurvivorPromotion,
} from '../../revocation/session-revocation.store';
import { Session, SessionDocument } from './schemas/session.schema';
import { SecurityEventService } from './security-event.service';
import { toObjectId } from './mongo-issuance-mappers';
import {
  castingId,
  isStorableId,
  toRevocableSession,
} from './mongo-session-records';
import { mongoSessionOf } from './mongo-unit-of-work';

const LIVE = { isValid: true, revokedAt: { $exists: false } } as const;

/**
 * Takes the account at the version write and a session at the write that ends
 * or promotes it: each conflicts with any other open transaction that wrote the
 * same document, and MongoDB refuses the later writer at once.
 *
 * The driver's own error leaves as raised: the runner that owns the transaction
 * maps it, and reads its labels to decide a rerun.
 */
@Injectable()
export class MongoSessionRevocationStore extends SessionRevocationStore {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly events: SecurityEventService,
  ) {
    super();
  }

  async readAccountForRevocation(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<RevocationAccount | null> {
    const user = await this.userModel
      .findById(toObjectId(userId))
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return user
      ? { id: user._id.toString(), sessionVersion: user.sessionVersion ?? 0 }
      : null;
  }

  countLiveSessions(
    unitOfWork: UnitOfWork,
    query: LiveSessionCount,
  ): Promise<number> {
    return this.sessionModel
      .countDocuments({
        user: toObjectId(query.userId),
        ...LIVE,
        expiresAt: { $gt: query.now },
        idleExpiresAt: { $gt: query.now },
        userVersion: query.userVersion,
      })
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  async advanceAccountVersion(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<void> {
    await this.userModel
      .updateOne({ _id: toObjectId(userId) }, { $inc: { sessionVersion: 1 } })
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  async advanceAccountVersionFrom(
    unitOfWork: UnitOfWork,
    userId: string,
    expected: number,
  ): Promise<AccountVersionAdvance> {
    const advanced = await this.userModel
      .updateOne(
        { _id: toObjectId(userId), sessionVersion: expected },
        { $inc: { sessionVersion: 1 } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return advanced.matchedCount === 1
      ? ACCOUNT_VERSION_ADVANCE.ADVANCED
      : ACCOUNT_VERSION_ADVANCE.VERSION_MOVED;
  }

  findLiveSessionByTokenHash(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<RevocableSession | null> {
    return this.findOne(unitOfWork, { tokenHash, ...LIVE });
  }

  findLiveSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<RevocableSession | null> {
    return castingId(() =>
      this.findOne(unitOfWork, {
        _id: sessionId,
        user: toObjectId(userId),
        ...LIVE,
      }),
    );
  }

  findSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<RevocableSession | null> {
    if (!isStorableId(sessionId)) {
      return Promise.reject(new MalformedIdError());
    }
    return this.findOne(unitOfWork, {
      _id: sessionId,
      user: toObjectId(userId),
    });
  }

  async revokeSession(
    unitOfWork: UnitOfWork,
    sessionId: string,
    mark: SessionRevocationMark,
  ): Promise<SessionRevocationOutcome> {
    const revoked = await this.sessionModel
      .updateOne(
        { _id: toObjectId(sessionId), ...LIVE },
        {
          $set: {
            isValid: false,
            revokedAt: mark.at,
            revokedReason: mark.reason,
          },
        },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return revoked.matchedCount === 1
      ? SESSION_REVOCATION.REVOKED
      : SESSION_REVOCATION.NOT_LIVE;
  }

  async promoteSurvivor(
    unitOfWork: UnitOfWork,
    sessionId: string,
    versions: { from: number; to: number },
  ): Promise<SurvivorPromotion> {
    const promoted = await this.sessionModel
      .updateOne(
        { _id: toObjectId(sessionId), ...LIVE, userVersion: versions.from },
        { $set: { userVersion: versions.to } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return promoted.matchedCount === 1
      ? SURVIVOR_PROMOTION.PROMOTED
      : SURVIVOR_PROMOTION.NOT_LIVE;
  }

  async appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void> {
    await this.events.record(event, mongoSessionOf(unitOfWork));
  }

  private async findOne(
    unitOfWork: UnitOfWork,
    filter: FilterQuery<Session>,
  ): Promise<RevocableSession | null> {
    const session = await this.sessionModel
      .findOne(filter)
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return session ? toRevocableSession(session) : null;
  }
}
