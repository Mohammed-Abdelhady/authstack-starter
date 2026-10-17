import { Db, ObjectId } from 'mongodb';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { AccountEraser } from '../../stores/account-eraser';
import type {
  AccountErasureRead,
  ErasureFacts,
  LinkedIdentity,
} from '../../types/erasure';
import {
  addressesToMatch,
  PERSONAL_DETAIL_FIELDS,
} from '../../utils/erasure-matches';

type AccountDocument = {
  _id: ObjectId;
  email: string;
  pendingEmail?: string;
  isDeleted: boolean;
  eraseAfter?: Date;
  linkedAccounts?: LinkedIdentity[];
  erasureFence?: number;
};

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new MalformedIdError();
  return new ObjectId(value);
}

export class MongoAccountEraser extends AccountEraser {
  constructor(private readonly db: Db) {
    super();
  }

  async readFactsIn(
    unitOfWork: UnitOfWork,
    userId: string,
    now: Date,
  ): Promise<AccountErasureRead | null> {
    const session = mongoSessionOf(unitOfWork);
    const id = objectId(userId);
    const account = await this.db
      .collection<AccountDocument>('users')
      .findOneAndUpdate(
        { _id: id, isDeleted: true, eraseAfter: { $lte: now } },
        { $inc: { erasureFence: 1 } },
        { session, returnDocument: 'after' },
      );
    if (!account) return null;
    const sessions = await this.db
      .collection('sessions')
      .find({ user: id }, { session, projection: { _id: 1 } })
      .toArray();
    return {
      accountId: id.toHexString(),
      onAccount: {
        address: account.email || null,
        pendingAddress: account.pendingEmail || null,
      },
      sessionIds: sessions.map((row) => row._id.toHexString()),
      identities: (account.linkedAccounts ?? []).map(
        ({ provider, providerId }) => ({
          provider,
          providerId,
        }),
      ),
    };
  }

  async eraseIn(unitOfWork: UnitOfWork, facts: ErasureFacts): Promise<void> {
    const session = mongoSessionOf(unitOfWork);
    const id = objectId(facts.accountId);
    const sessionIds = facts.sessionIds.map(objectId);
    const addresses = addressesToMatch(facts.addresses);
    if (sessionIds.length > 0) {
      await this.db
        .collection('nativecredentials')
        .deleteMany({ sessionId: { $in: sessionIds } }, { session });
    }
    await this.db.collection('sessions').deleteMany({ user: id }, { session });
    await this.db
      .collection('authorizationtransactions')
      .deleteMany({ userId: id }, { session });
    await this.db
      .collection('userapplicationgrants')
      .deleteMany({ userId: id }, { session });
    // feature:passkeys:start
    await this.db.collection('passkeys').deleteMany({ user: id }, { session });
    await this.db
      .collection('passkeychallenges')
      .deleteMany(
        { $or: [{ user: id }, { sessionId: { $in: facts.sessionIds } }] },
        { session },
      );
    // feature:passkeys:end
    // feature:totp:start
    await this.db
      .collection('twofactorchallenges')
      .deleteMany({ user: id }, { session });
    // feature:totp:end
    // feature:oauth-core:start
    await this.db
      .collection('provider_link_tickets')
      .deleteMany({ userId: facts.accountId }, { session });
    // feature:oauth-core:end
    await this.db.collection('native_attempts').deleteMany(
      {
        $or: [
          { 'details.verifiedAccount.userId': facts.accountId },
          { 'details.email.address': { $in: addresses } },
        ],
      },
      { session },
    );
    await this.db
      .collection<{ _id: string; owner: string }>('addressclaims')
      .deleteMany({ owner: facts.accountId }, { session });
    await this.db
      .collection('pendingregistrations')
      .deleteMany(
        { $or: [{ userId: id }, { email: { $in: addresses } }] },
        { session },
      );
    if (addresses.length > 0) {
      await this.db
        .collection('pendingpasswordresets')
        .deleteMany({ email: { $in: addresses } }, { session });
      await this.db
        .collection('mailcounters')
        .deleteMany({ email: { $in: addresses } }, { session });
      // feature:magic-link:start
      await this.db
        .collection('pendingmagiclinks')
        .deleteMany({ email: { $in: addresses } }, { session });
      // feature:magic-link:end
      // feature:email-code:start
      await this.db
        .collection('email_codes')
        .deleteMany({ email: { $in: addresses } }, { session });
      // feature:email-code:end
    }
    const personalFields = Object.fromEntries(
      PERSONAL_DETAIL_FIELDS.map((field) => [`details.${field}`, '']),
    );
    await this.db.collection('securityevents').updateMany(
      {
        $or: [{ actorId: facts.accountId }, { targetUserId: facts.accountId }],
      },
      { $unset: personalFields },
      { session },
    );
    await this.db.collection('users').deleteOne({ _id: id }, { session });
  }
}
