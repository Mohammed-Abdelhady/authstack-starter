import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
// feature:passkeys:start
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
// feature:passkeys:end
import type { Model } from 'mongoose';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  type CredentialRelyingParty, // feature:passkeys
  EnrolmentStore,
} from '../../enrolment/enrolment.store';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { REVOKED_REASON } from '../../constants/revoked-reason';
import { mongoSessionOf } from './mongo-unit-of-work';
import { toObjectId } from './mongo-issuance-mappers';
import { toStoredSession } from './mongo-session-records';
import { Session, type SessionDocument } from './schemas/session.schema';

@Injectable()
export class MongoEnrolmentStore extends EnrolmentStore {
  constructor(
    @InjectModel(Session.name)
    private readonly sessions: Model<SessionDocument>,
    // feature:passkeys:start
    @InjectConnection() private readonly connection: Connection,
    // feature:passkeys:end
  ) {
    super();
  }

  // feature:passkeys:start
  override async hasCredentialIn(
    work: UnitOfWork,
    userId: string,
    credentialId: string,
    relyingParty: CredentialRelyingParty,
  ): Promise<boolean> {
    const credential = await this.connection.collection('passkeys').findOne(
      {
        user: toObjectId(userId),
        credentialId,
        ...(relyingParty.includesUnmarked
          ? { $or: [{ rpId: { $eq: relyingParty.rpId } }, { rpId: null }] }
          : { rpId: { $eq: relyingParty.rpId } }),
      },
      { session: mongoSessionOf(work), projection: { _id: 1 } },
    );
    return credential !== null;
  }
  // feature:passkeys:end

  async readSessionIn(work: UnitOfWork, sessionId: string) {
    const row = await this.sessions
      .findById(toObjectId(sessionId))
      .session(mongoSessionOf(work))
      .exec();
    return row ? toStoredSession(row) : null;
  }

  async retireIn(work: UnitOfWork, sessionId: string, now: Date) {
    const result = await this.sessions.updateOne(
      {
        _id: toObjectId(sessionId),
        credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT,
        isValid: true,
        revokedAt: null,
        expiresAt: { $gt: now },
        idleExpiresAt: { $gt: now },
      },
      {
        $set: {
          isValid: false,
          revokedAt: now,
          revokedReason: REVOKED_REASON.ENROLMENT_PROMOTED,
        },
      },
      { session: mongoSessionOf(work) },
    );
    return result.modifiedCount === 1;
  }

  async replaceIn(
    work: UnitOfWork,
    userId: string,
    clientId: string,
    now: Date,
  ): Promise<string[]> {
    const session = mongoSessionOf(work);
    const live = {
      user: toObjectId(userId),
      clientId,
      credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT,
      isValid: true,
      revokedAt: null,
    };
    // Both statements share the transaction's snapshot; a concurrent change
    // to one of these sessions makes the update conflict and the work rerun.
    const replaced = await this.sessions
      .find(live)
      .select('_id')
      .session(session)
      .lean()
      .exec();
    if (replaced.length === 0) return [];
    const ids = replaced.map(({ _id }) => _id);
    await this.sessions.updateMany(
      { ...live, _id: { $in: ids } },
      {
        $set: {
          isValid: false,
          revokedAt: now,
          revokedReason: REVOKED_REASON.ENROLMENT_REPLACED,
        },
      },
      { session },
    );
    return ids.map((id) => id.toString());
  }
}
