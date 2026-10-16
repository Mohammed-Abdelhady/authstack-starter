import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { isMongoDuplicateKeyError } from '../../../common/persistence/mongo/mongo-error.util';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { IDEMPOTENCY_CLAIM } from '../../constants/staff-operations';
import { StaffIdempotencyStore } from '../../stores/staff-idempotency.store';
import {
  IdempotencyClaim,
  IdempotencyClaimInput,
  IdempotencyScope,
} from '../../types/staff-idempotency';
import {
  StaffIdempotencyKey,
  StaffIdempotencyKeyDocument,
} from './schemas/staff-idempotency-key.schema';

@Injectable()
export class MongoStaffIdempotencyStore extends StaffIdempotencyStore {
  constructor(
    @InjectModel(StaffIdempotencyKey.name)
    private readonly keys: Model<StaffIdempotencyKeyDocument>,
  ) {
    super();
  }

  async claim(
    uow: UnitOfWork,
    input: IdempotencyClaimInput,
  ): Promise<IdempotencyClaim> {
    const session = mongoSessionOf(uow);
    const _id = scopeId(input.scope);
    // A duplicate upsert aborts a MongoDB transaction before it can read again.
    const live = await this.keys
      .findOne({ _id, expiresAt: { $gt: input.now } })
      .session(session)
      .lean()
      .exec();
    if (live) return existingClaim(live);
    try {
      await this.keys
        .findOneAndUpdate(
          { _id, expiresAt: { $lte: input.now } },
          {
            $set: {
              requestHash: input.requestHash,
              resourceId: null,
              createdAt: input.now,
              expiresAt: input.expiresAt,
            },
          },
          { upsert: true, session },
        )
        .exec();
      return { status: IDEMPOTENCY_CLAIM.CLAIMED };
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) throw error;
    }
    const existing = await this.keys
      .findById(_id)
      .session(session)
      .lean()
      .orFail()
      .exec();
    return existingClaim(existing);
  }

  async complete(
    uow: UnitOfWork,
    scope: IdempotencyScope,
    resourceId: string,
  ): Promise<void> {
    await this.keys
      .updateOne(
        { _id: scopeId(scope) },
        { $set: { resourceId } },
        { session: mongoSessionOf(uow) },
      )
      .exec();
  }
}

function scopeId(scope: IdempotencyScope): string {
  return JSON.stringify([
    scope.actorId,
    scope.clientId,
    scope.operation,
    scope.key,
  ]);
}

function existingClaim(
  record: Pick<StaffIdempotencyKey, 'requestHash' | 'resourceId'>,
): IdempotencyClaim {
  return {
    status: IDEMPOTENCY_CLAIM.EXISTING,
    requestHash: record.requestHash,
    resourceId: record.resourceId,
  };
}
