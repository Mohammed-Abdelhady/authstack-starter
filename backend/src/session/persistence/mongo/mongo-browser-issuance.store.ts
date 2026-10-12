import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  ACCOUNT_ISSUANCE_MARK,
  AccountIssuanceMark,
  BrowserIssuanceStore,
  deviceLabelOf,
  IssuanceAccount,
  IssuanceApplication,
  IssuanceGrant,
  IssuanceSecurityEvent,
  NewBrowserSession,
  NewIssuanceGrant,
  SessionCapCandidate,
  SessionCapQuery,
} from '../../issuance/browser-issuance.store';
import {
  LeanSession,
  Session,
  SessionDocument,
} from './schemas/session.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantDocument,
} from './schemas/user-application-grant.schema';
import { ApplicationRegistryService } from './application-registry.service';
import { SecurityEventService } from './security-event.service';
import { currentSessionCandidateFilter } from './mongo-session-candidate-filter';
import {
  toIssuanceAccount,
  toIssuanceApplication,
  toIssuanceGrant,
  toObjectId,
} from './mongo-issuance-mappers';
import { isStorableId } from './mongo-session-records';
import { mongoSessionOf } from './mongo-unit-of-work';

type LeanGrant = UserApplicationGrant & { _id: Types.ObjectId };

/**
 * Takes the account at `markAccountIssuance`: the write to the account conflicts
 * with any other open transaction that wrote it, and MongoDB refuses the later
 * writer at once.
 */
@Injectable()
export class MongoBrowserIssuanceStore extends BrowserIssuanceStore {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserApplicationGrant.name)
    private readonly grantModel: Model<UserApplicationGrantDocument>,
    private readonly applications: ApplicationRegistryService,
    private readonly events: SecurityEventService,
  ) {
    super();
  }

  async findAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<IssuanceAccount | null> {
    // Mongoose decides what an id is here, as it did before this read moved.
    if (!isStorableId(userId)) {
      throw new MalformedIdError();
    }
    const user = await this.userModel
      .findById(userId)
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return user ? toIssuanceAccount(user) : null;
  }

  async readAccountForIssuance(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<IssuanceAccount | null> {
    const user = await this.userModel
      .findById(toObjectId(userId))
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return user ? toIssuanceAccount(user) : null;
  }

  async markAccountIssuance(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<AccountIssuanceMark> {
    const result = await this.userModel
      .updateOne({ _id: toObjectId(userId) }, { $inc: { issuanceFence: 1 } })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return result.matchedCount === 1
      ? ACCOUNT_ISSUANCE_MARK.MARKED
      : ACCOUNT_ISSUANCE_MARK.ACCOUNT_MISSING;
  }

  async findGrant(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<IssuanceGrant | null> {
    const grant = await this.grantModel
      .findOne({ userId: toObjectId(userId), clientId })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return grant ? toIssuanceGrant(grant) : null;
  }

  async createGrant(
    unitOfWork: UnitOfWork,
    grant: NewIssuanceGrant,
  ): Promise<IssuanceGrant> {
    const [created] = await this.grantModel.create(
      [
        {
          userId: toObjectId(grant.userId),
          clientId: grant.clientId,
          allowedScopes: grant.allowedScopes,
          allowed: true,
          sessionVersion: 0,
          issuanceFence: 0,
        },
      ],
      { session: mongoSessionOf(unitOfWork) },
    );
    return toIssuanceGrant(created);
  }

  async markGrantIssuance(
    unitOfWork: UnitOfWork,
    grantId: string,
  ): Promise<void> {
    await this.grantModel
      .updateOne({ _id: toObjectId(grantId) }, { $inc: { issuanceFence: 1 } })
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  async listSessionCapCandidates(
    unitOfWork: UnitOfWork,
    query: SessionCapQuery,
  ): Promise<SessionCapCandidate[]> {
    const session = mongoSessionOf(unitOfWork);
    const userId = toObjectId(query.userId);
    const sessions = await this.sessionModel
      .find(
        currentSessionCandidateFilter(
          userId,
          query.now,
          query.userVersion,
          query.authEpoch,
          query.purposes,
        ),
      )
      .session(session)
      .lean<LeanSession[]>()
      .exec();
    const clientIds = [...new Set(sessions.map(({ clientId }) => clientId))];
    const applications = await this.applications.findByClientIds(
      clientIds,
      session,
    );
    const grants =
      clientIds.length === 0
        ? []
        : await this.grantModel
            .find({ userId, clientId: { $in: clientIds } })
            .session(session)
            .lean<LeanGrant[]>()
            .exec();
    const applicationByClientId = new Map<string, IssuanceApplication>();
    for (const application of applications) {
      applicationByClientId.set(
        application.clientId,
        toIssuanceApplication(application),
      );
    }
    const grantByClientId = new Map<string, IssuanceGrant>();
    for (const grant of grants) {
      grantByClientId.set(grant.clientId, toIssuanceGrant(grant));
    }
    return sessions.map((candidate) => ({
      session: candidate,
      application: applicationByClientId.get(candidate.clientId) ?? null,
      grant: grantByClientId.get(candidate.clientId) ?? null,
    }));
  }

  async insertBrowserSession(
    unitOfWork: UnitOfWork,
    session: NewBrowserSession,
  ): Promise<string> {
    const { userId, ...fields } = session;
    const [created] = await this.sessionModel.create(
      [
        {
          ...fields,
          device: deviceLabelOf(fields.device),
          user: toObjectId(userId),
          isValid: true,
        },
      ],
      { session: mongoSessionOf(unitOfWork) },
    );
    return created._id.toString();
  }

  async appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: IssuanceSecurityEvent,
  ): Promise<void> {
    await this.events.record(event, mongoSessionOf(unitOfWork));
  }
}
