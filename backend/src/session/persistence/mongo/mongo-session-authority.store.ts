import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  AccountIdentity,
  AccountNotHandedOutError,
  AuthorityAccount,
  AuthorityGrant,
  IDLE_EXTENSION,
  IdleExtension,
  IdleExtensionOutcome,
  SessionAuthorityStore,
  SessionCandidateQuery,
  StoredSession,
} from '../../authority/session-authority.store';
import {
  LeanSession,
  Session,
  SessionDocument,
} from './schemas/session.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantDocument,
} from './schemas/user-application-grant.schema';
import { currentSessionCandidateFilter } from './mongo-session-candidate-filter';
import { linearizable } from '../../../common/persistence/mongo/linearizable-query';
import { toIssuanceGrant, toObjectId } from './mongo-issuance-mappers';
import {
  authorityDocumentOf,
  castingId,
  toAccountIdentity,
  toAuthorityAccount,
  toStoredSession,
} from './mongo-session-records';

type LeanGrant = UserApplicationGrant & { _id: Types.ObjectId };

/**
 * A committed authority read is a linearizable read on the primary with a
 * deadline: the primary confirms with a majority that it still is the primary
 * before it answers, so the answer holds every write acknowledged before the
 * read began. It carries no session, so it can never join a transaction.
 */
@Injectable()
export class MongoSessionAuthorityStore extends SessionAuthorityStore {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserApplicationGrant.name)
    private readonly grantModel: Model<UserApplicationGrantDocument>,
  ) {
    super();
  }

  async readCommittedSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const session = await singleStatement(() =>
      linearizable(this.sessionModel.findOne({ tokenHash })).exec(),
    );
    return session ? toStoredSession(session) : null;
  }

  async readCommittedSessionById(
    sessionId: string,
  ): Promise<StoredSession | null> {
    const id = toObjectId(sessionId);
    const session = await singleStatement(() =>
      linearizable(this.sessionModel.findById(id)).exec(),
    );
    return session ? toStoredSession(session) : null;
  }

  async readCommittedAccount(userId: string): Promise<AuthorityAccount | null> {
    const id = toObjectId(userId);
    const user = await singleStatement(() =>
      linearizable(this.userModel.findById(id)).exec(),
    );
    return user ? toAuthorityAccount(user) : null;
  }

  describeAccount(account: AuthorityAccount): Promise<AccountIdentity | null> {
    const held = authorityDocumentOf(account);
    if (!held) {
      return Promise.reject(new AccountNotHandedOutError());
    }
    return Promise.resolve(toAccountIdentity(held));
  }

  async readCommittedGrant(
    userId: string,
    clientId: string,
  ): Promise<AuthorityGrant | null> {
    const id = toObjectId(userId);
    const grant = await singleStatement(() =>
      linearizable(this.grantModel.findOne({ userId: id, clientId })).exec(),
    );
    return grant ? toIssuanceGrant(grant) : null;
  }

  async readCommittedGrants(
    userId: string,
    clientIds: string[],
  ): Promise<AuthorityGrant[]> {
    const id = toObjectId(userId);
    const grants = await singleStatement(() =>
      linearizable(
        this.grantModel.find({ userId: id, clientId: { $in: clientIds } }),
      )
        .lean<LeanGrant[]>()
        .exec(),
    );
    return grants.map(toIssuanceGrant);
  }

  async listSessionCandidates(
    query: SessionCandidateQuery,
  ): Promise<StoredSession[]> {
    const filter = currentSessionCandidateFilter(
      toObjectId(query.userId),
      query.now,
      query.userVersion,
      query.authEpoch,
      query.purposes,
    );
    const sessions = await singleStatement(() =>
      this.sessionModel
        .find(filter)
        .sort({ lastUsedAt: -1 })
        .lean<LeanSession[]>()
        .exec(),
    );
    return sessions.map(toStoredSession);
  }

  async findSessionById(sessionId: string): Promise<StoredSession | null> {
    const session = await castingId(() =>
      singleStatement(() =>
        this.sessionModel.findById(sessionId).lean<LeanSession | null>().exec(),
      ),
    );
    return session ? toStoredSession(session) : null;
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const session = await singleStatement(() =>
      this.sessionModel
        .findOne({ tokenHash })
        .lean<LeanSession | null>()
        .exec(),
    );
    return session ? toStoredSession(session) : null;
  }

  async extendIdle(
    sessionId: string,
    extension: IdleExtension,
  ): Promise<IdleExtensionOutcome> {
    const id = toObjectId(sessionId);
    const { now, idleExpiresAt } = extension;
    const result = await singleStatement(() =>
      this.sessionModel.updateOne(
        {
          _id: id,
          isValid: true,
          revokedAt: { $exists: false },
          idleExpiresAt: { $gt: now },
          expiresAt: { $gt: now },
        },
        { $set: { lastUsedAt: now, lastActivityAt: now, idleExpiresAt } },
      ),
    );
    return result.matchedCount > 0
      ? IDLE_EXTENSION.EXTENDED
      : IDLE_EXTENSION.NOT_LIVE;
  }
}
