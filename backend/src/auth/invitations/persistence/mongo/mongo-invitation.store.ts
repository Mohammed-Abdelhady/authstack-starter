import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { toObjectId } from '../../../../session/persistence/mongo/mongo-issuance-mappers';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { storedLocale } from '../../../../common/constants/locales';
import { storedAddress } from '../../../../common/persistence/stored-address';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { ROLE_AUDIENCE } from '../../../../host/types/host-role.type';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  INVITATION_PURPOSE,
  INVITATION_STATUS,
} from '../../constants/invitations';
import { InvitationStore } from '../../stores/invitation.store';
import {
  InvitationListQuery,
  InvitationTokenChange,
  NewInvitation,
  StoredInvitation,
} from '../../types/invitation';
import { Invitation, InvitationDocument } from './invitation.schema';

function stored(row: Invitation): StoredInvitation {
  return {
    id: row._id,
    purpose: row.purpose,
    email: row.email,
    name: row.name,
    roleId: row.roleId,
    roleSlug: row.roleSlug,
    audience: row.audience,
    clientId: row.clientId,
    invitedBy: row.invitedBy,
    userId: row.userId,
    addressGeneration: row.addressGeneration,
    locale: storedLocale(row.locale),
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class MongoInvitationStore extends InvitationStore {
  constructor(
    @InjectModel(Invitation.name)
    private readonly invitations: Model<InvitationDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    super();
  }

  async insert(
    work: UnitOfWork,
    input: NewInvitation,
  ): Promise<StoredInvitation> {
    const row = new this.invitations({
      ...input,
      _id: randomUUID(),
      email: storedAddress(input.email),
      createdAt: input.now,
      updatedAt: input.now,
    });
    await row.save({ session: mongoSessionOf(work) });
    return stored(row);
  }

  async findById(id: string): Promise<StoredInvitation | null> {
    const row = await this.invitations.findById(id).lean().exec();
    return row ? stored(row) : null;
  }

  takeById(work: UnitOfWork, id: string): Promise<StoredInvitation | null> {
    return this.take(work, { _id: id });
  }

  takeByTokenHash(
    work: UnitOfWork,
    tokenHash: string,
  ): Promise<StoredInvitation | null> {
    return this.take(work, { tokenHash });
  }

  private async take(
    work: UnitOfWork,
    filter: FilterQuery<Invitation>,
  ): Promise<StoredInvitation | null> {
    const row = await this.invitations
      .findOneAndUpdate(
        filter,
        { $inc: { lockVersion: 1 } },
        { session: mongoSessionOf(work), returnDocument: 'after' },
      )
      .lean()
      .exec();
    return row ? stored(row) : null;
  }

  async replaceToken(
    work: UnitOfWork,
    id: string,
    input: InvitationTokenChange,
  ): Promise<StoredInvitation> {
    const row = await this.invitations
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            purgeAfter: input.purgeAfter,
            updatedAt: input.now,
          },
        },
        { session: mongoSessionOf(work), returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!row) throw new Error('Invitation disappeared during replacement');
    return stored(row);
  }

  async markAccepted(work: UnitOfWork, id: string, at: Date): Promise<void> {
    await this.invitations
      .updateOne(
        { _id: id },
        { $set: { acceptedAt: at, updatedAt: at } },
        { session: mongoSessionOf(work) },
      )
      .exec();
  }

  async markRevoked(work: UnitOfWork, id: string, at: Date): Promise<void> {
    await this.invitations
      .updateOne(
        { _id: id },
        { $set: { revokedAt: at, updatedAt: at } },
        { session: mongoSessionOf(work) },
      )
      .exec();
  }

  async revokeOpenEnrolmentLinks(
    work: UnitOfWork,
    userId: string,
    at: Date,
  ): Promise<number> {
    // Lock the account even when there are no earlier links to update.
    await this.users
      .findOneAndUpdate(
        { _id: toObjectId(userId) },
        { $inc: { grantAuthorityFence: 1 } },
        { session: mongoSessionOf(work), timestamps: false },
      )
      .exec();
    const result = await this.invitations
      .updateMany(
        { userId, purpose: INVITATION_PURPOSE.ENROLMENT, ...open(at) },
        { $set: { revokedAt: at, updatedAt: at } },
        { session: mongoSessionOf(work) },
      )
      .exec();
    return result.modifiedCount;
  }

  async list(query: InvitationListQuery) {
    if (query.audiences?.length === 0) return { invitations: [], total: 0 };
    const filter: FilterQuery<Invitation> = {
      purpose: {
        $in: [INVITATION_PURPOSE.ACCOUNT, INVITATION_PURPOSE.FIRST_ADMIN],
      },
    };
    if (query.audiences) {
      filter.$or = [
        { audience: { $in: query.audiences } },
        ...(query.audiences.includes(ROLE_AUDIENCE.CUSTOMER)
          ? [{ audience: null }]
          : []),
      ];
    }
    if (query.status === INVITATION_STATUS.ACCEPTED)
      filter.acceptedAt = { $ne: null };
    if (query.status === INVITATION_STATUS.REVOKED)
      Object.assign(filter, { acceptedAt: null, revokedAt: { $ne: null } });
    if (query.status === INVITATION_STATUS.PENDING)
      Object.assign(filter, open(query.now));
    if (query.status === INVITATION_STATUS.EXPIRED)
      Object.assign(filter, {
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { $lte: query.now },
      });
    const total = await this.invitations.countDocuments(filter).exec();
    const rows = await this.invitations
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean()
      .exec();
    return { invitations: rows.map(stored), total };
  }

  async hasOpenAdminInvitation(
    work: UnitOfWork,
    adminRole: string,
    now: Date,
  ): Promise<boolean> {
    const row = await this.invitations
      .findOne({
        ...open(now),
        $or: [
          { purpose: INVITATION_PURPOSE.FIRST_ADMIN },
          { purpose: INVITATION_PURPOSE.ACCOUNT, roleSlug: adminRole },
        ],
      })
      .session(mongoSessionOf(work))
      .select('_id')
      .lean()
      .exec();
    return row !== null;
  }
}

function open(now: Date): FilterQuery<Invitation> {
  return { acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } };
}
