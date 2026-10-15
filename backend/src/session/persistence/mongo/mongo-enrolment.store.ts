import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
// feature:passkeys:start
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
// feature:passkeys:end
import type { Model } from 'mongoose';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { EnrolmentStore } from '../../enrolment/enrolment.store';
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
  ): Promise<boolean> {
    const credential = await this.connection
      .collection('passkeys')
      .findOne(
        { user: toObjectId(userId), credentialId },
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
  ): Promise<void> {
    await this.sessions.updateMany(
      {
        user: toObjectId(userId),
        clientId,
        credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT,
        isValid: true,
        revokedAt: null,
      },
      {
        $set: {
          isValid: false,
          revokedAt: now,
          revokedReason: REVOKED_REASON.ENROLMENT_REPLACED,
        },
      },
      { session: mongoSessionOf(work) },
    );
  }
}
