import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { singleStatement } from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { CREDENTIAL_PURPOSE } from '../../../constants/credential-purpose';
import { toObjectId } from '../../../persistence/mongo/mongo-issuance-mappers';
import {
  NativeCredential,
  NativeCredentialDocument,
} from '../../../persistence/mongo/schemas/native-credential.schema';
import { linearizable } from '../../../../common/persistence/mongo/linearizable-query';
import {
  FIRST_USE,
  FirstUse,
  LiveAccessCredential,
  NativeAccessStore,
} from '../../credentials/native-access.store';

const NEVER_SET = { $exists: false } as const;

/** Both reads are linearizable: primary, and the bounded deadline. */
@Injectable()
export class MongoNativeAccessStore extends NativeAccessStore {
  constructor(
    @InjectModel(NativeCredential.name)
    private readonly credentials: Model<NativeCredentialDocument>,
  ) {
    super();
  }

  async readCommittedAccessCredential(
    tokenHash: string,
    now: Date,
  ): Promise<LiveAccessCredential | null> {
    const credential = await singleStatement(() =>
      linearizable(
        this.credentials.findOne({
          tokenHash,
          purpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
          spent: false,
          revokedAt: NEVER_SET,
          expiresAt: { $gt: now },
        }),
      ).exec(),
    );
    return credential
      ? {
          id: credential._id.toString(),
          sessionId: credential.sessionId.toString(),
          proofKeyThumbprint: credential.proofKeyThumbprint ?? null,
        }
      : null;
  }

  async markFirstUse(credentialId: string, now: Date): Promise<FirstUse> {
    const marked = await singleStatement(() =>
      this.credentials
        .updateOne(
          {
            _id: toObjectId(credentialId),
            spent: false,
            revokedAt: NEVER_SET,
            firstUsedAt: NEVER_SET,
          },
          { $set: { firstUsedAt: now } },
        )
        .exec(),
    );
    return marked.matchedCount === 0 ? FIRST_USE.NOT_MARKED : FIRST_USE.MARKED;
  }

  async readCommittedAccessIsLive(
    credentialId: string,
    now: Date,
  ): Promise<boolean> {
    const active = await singleStatement(() =>
      linearizable(
        this.credentials.findOne({
          _id: toObjectId(credentialId),
          spent: false,
          revokedAt: NEVER_SET,
          expiresAt: { $gt: now },
        }),
      )
        .select('_id')
        .exec(),
    );
    return active !== null;
  }
}
