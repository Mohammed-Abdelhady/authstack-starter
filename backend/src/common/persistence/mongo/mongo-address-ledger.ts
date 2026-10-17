import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  AddressLedger,
} from '../address-ledger';
import { storedAddress } from '../stored-address';
import {
  AddressClaimInput,
  AddressClaimResult,
  AddressAvailability,
  AddressRelease,
  OwnedAddressLookup,
} from '../types/address-ledger';
import { UnitOfWork } from '../unit-of-work';
import { isMongoDuplicateKeyError } from './mongo-error.util';
import {
  AddressClaim,
  AddressClaimDocument,
} from './schemas/address-claim.schema';

@Injectable()
export class MongoAddressLedger extends AddressLedger {
  constructor(
    @InjectModel(AddressClaim.name)
    private readonly claims: Model<AddressClaimDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    super();
  }

  async claim(
    uow: UnitOfWork,
    input: AddressClaimInput,
  ): Promise<AddressClaimResult> {
    const session = mongoSessionOf(uow);
    const address = storedAddress(input.address);
    try {
      await this.claims
        .findOneAndUpdate(
          {
            _id: address,
            $or: [
              { lapsesAt: { $lte: input.now } },
              { owner: input.owner },
              ...(input.replaceOwnEmailChange
                ? [{ kind: ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE }]
                : []),
            ],
          },
          {
            $set: {
              kind: input.kind,
              owner: input.owner,
              lapsesAt: input.lapsesAt,
            },
          },
          { upsert: true, session, returnDocument: 'after' },
        )
        .exec();
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) return ADDRESS_CLAIM_RESULT.TAKEN;
      // Transient write conflicts must reach the runner for a fresh snapshot.
      throw error;
    }
    const account = await this.users
      .findOne({ email: address })
      .select('_id')
      .session(session)
      .lean()
      .exec();
    return account && account._id.toString() !== input.owner
      ? ADDRESS_CLAIM_RESULT.TAKEN
      : ADDRESS_CLAIM_RESULT.CLAIMED;
  }

  async holdsLiveClaim(
    uow: UnitOfWork,
    input: OwnedAddressLookup,
  ): Promise<boolean> {
    const claim = await this.claims
      .findOneAndUpdate(
        {
          _id: storedAddress(input.address),
          owner: input.owner,
          lapsesAt: { $gt: input.now },
        },
        // A same-owner write alone can be a no-op and leave the row unlocked.
        { $set: { owner: input.owner }, $inc: { lockVersion: 1 } },
        { session: mongoSessionOf(uow), returnDocument: 'after' },
      )
      .exec();
    return claim !== null;
  }

  async release(uow: UnitOfWork, input: AddressRelease): Promise<void> {
    await this.claims
      .deleteOne(
        {
          _id: storedAddress(input.address),
          owner: input.owner,
        },
        { session: mongoSessionOf(uow) },
      )
      .exec();
  }

  /** Both reads run on every path, so a held address answers no sooner. */
  async isFree(uow: UnitOfWork, input: AddressAvailability): Promise<boolean> {
    const session = mongoSessionOf(uow);
    const address = storedAddress(input.address);
    const account = await this.users
      .findOne({ email: address })
      .select('_id')
      .session(session)
      .lean()
      .exec();
    const claim = await this.claims
      .findOne({
        _id: address,
        lapsesAt: { $gt: input.now },
        ...(input.forRegistration
          ? { kind: { $ne: ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE } }
          : {}),
        ...(input.owner === undefined ? {} : { owner: { $ne: input.owner } }),
      })
      .session(session)
      .lean()
      .exec();
    return account === null && claim === null;
  }
}
