import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mapMongoError } from '../../../../session/persistence/mongo/mongo-persistence-errors';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  insertOrConflict,
  singleStatement,
} from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { Passkey, PasskeyDocument } from './schemas/passkey.schema';
import {
  COUNTER_OUTCOME,
  CounterOutcome,
  NewPasskey,
  PASSKEY_CONSTRAINT,
  PasskeyDescriptor,
  PasskeyStore,
  RelyingPartyScope,
  StoredPasskey,
} from '../../stores/passkey.store';

/** Index names of the collection to the rules' shared names. */
const PASSKEY_CONSTRAINTS: Readonly<Record<string, string>> = {
  credentialId_1: PASSKEY_CONSTRAINT.CREDENTIAL_ID,
};

// A write goes through the document its record was read from.
const DOCUMENTS = new WeakMap<StoredPasskey, PasskeyDocument>();

function documentOf(passkey: StoredPasskey): PasskeyDocument {
  const document = DOCUMENTS.get(passkey);
  if (!document) {
    throw new Error('This passkey was not read from MongoDB');
  }
  return document;
}

/** The record for a document, tied to it for the writes that follow. */
export function toStoredPasskey(document: PasskeyDocument): StoredPasskey {
  const passkey: StoredPasskey = {
    id: document._id.toString(),
    userId: document.user.toString(),
    ...(document.rpId ? { rpId: document.rpId } : {}),
    credentialId: document.credentialId,
    // Plain values: a document hands out its own buffer and array types.
    publicKey: Buffer.from(document.publicKey),
    counter: document.counter,
    transports: [...document.transports],
    deviceType: document.deviceType,
    backedUp: document.backedUp,
    name: document.name,
    lastUsedAt: document.lastUsedAt,
    createdAt: document.createdAt,
  };
  DOCUMENTS.set(passkey, document);
  return passkey;
}

/** Documents of the relying party, and unmarked ones when the scope does. */
function inRelyingParty(
  relyingParty: RelyingPartyScope,
): FilterQuery<PasskeyDocument> {
  return relyingParty.includesUnmarked
    ? { $or: [{ rpId: { $eq: relyingParty.rpId } }, { rpId: null }] }
    : { rpId: { $eq: relyingParty.rpId } };
}

/**
 * One statement that commits by itself. An id Mongoose cannot cast leaves as
 * the shared malformed id, over the cast error the filter already answers.
 */
async function passkeyStatement<Result>(
  statement: () => Promise<Result>,
): Promise<Result> {
  try {
    return await singleStatement(statement);
  } catch (error) {
    const mapped = mapMongoError(error);
    throw mapped instanceof MalformedIdError ? mapped : error;
  }
}

/** One document per passkey, under a unique index on the credential id. */
@Injectable()
export class MongoPasskeyStore extends PasskeyStore {
  constructor(
    @InjectModel(Passkey.name)
    private readonly passkeyModel: Model<PasskeyDocument>,
  ) {
    super();
  }

  async listDescriptors(
    userId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<PasskeyDescriptor[]> {
    const user = toObjectId(userId);
    const read = () =>
      this.passkeyModel
        .find(
          { user },
          null,
          unitOfWork ? { session: mongoSessionOf(unitOfWork) } : undefined,
        )
        .select('credentialId transports');
    const existing = unitOfWork ? await read() : await passkeyStatement(read);
    return existing.map((passkey) => ({
      credentialId: passkey.credentialId,
      transports: passkey.transports,
    }));
  }

  async listDescriptorsFor(
    userId: string,
    relyingParty: RelyingPartyScope,
    unitOfWork?: UnitOfWork,
  ): Promise<PasskeyDescriptor[]> {
    const user = toObjectId(userId);
    const read = () =>
      this.passkeyModel
        .find(
          { user, ...inRelyingParty(relyingParty) },
          null,
          unitOfWork ? { session: mongoSessionOf(unitOfWork) } : undefined,
        )
        .select('credentialId transports');
    const existing = unitOfWork ? await read() : await passkeyStatement(read);
    return existing.map((passkey) => ({
      credentialId: passkey.credentialId,
      transports: passkey.transports,
    }));
  }

  async countForRelyingParty(
    userId: string,
    relyingParty: RelyingPartyScope,
    unitOfWork?: UnitOfWork,
  ): Promise<number> {
    const user = toObjectId(userId);
    const count = () =>
      this.passkeyModel
        .countDocuments({ user, ...inRelyingParty(relyingParty) })
        .session(unitOfWork ? mongoSessionOf(unitOfWork) : null)
        .exec();
    return unitOfWork ? count() : passkeyStatement(count);
  }

  async isCredentialRegistered(credentialId: string): Promise<boolean> {
    return Boolean(
      await passkeyStatement(() => this.passkeyModel.exists({ credentialId })),
    );
  }

  async insert(
    passkey: NewPasskey,
    unitOfWork?: UnitOfWork,
  ): Promise<StoredPasskey> {
    const fields = {
      user: toObjectId(passkey.userId),
      rpId: passkey.rpId,
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: passkey.counter,
      transports: passkey.transports,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      name: passkey.name,
      lastUsedAt: null,
    };
    if (!unitOfWork) {
      const created = await insertOrConflict(PASSKEY_CONSTRAINTS, () =>
        this.passkeyModel.create(fields),
      );
      return toStoredPasskey(created);
    }
    const [created] = await insertOrConflict(PASSKEY_CONSTRAINTS, () =>
      this.passkeyModel.create([fields], {
        session: mongoSessionOf(unitOfWork),
      }),
    );
    return toStoredPasskey(created);
  }

  async findByCredentialId(
    credentialId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<StoredPasskey | null> {
    const read = () =>
      this.passkeyModel.findOne(
        { credentialId: { $eq: credentialId } },
        null,
        unitOfWork ? { session: mongoSessionOf(unitOfWork) } : undefined,
      );
    const passkey = unitOfWork ? await read() : await passkeyStatement(read);
    return passkey ? toStoredPasskey(passkey) : null;
  }

  async advanceCounter(
    passkey: StoredPasskey,
    use: { counter: number; usedAt: Date },
    unitOfWork?: UnitOfWork,
  ): Promise<CounterOutcome> {
    const document = documentOf(passkey);
    const update = () =>
      this.passkeyModel.updateOne(
        { _id: document._id, counter: passkey.counter },
        { $set: { counter: use.counter, lastUsedAt: use.usedAt } },
        unitOfWork ? { session: mongoSessionOf(unitOfWork) } : undefined,
      );
    const updated = unitOfWork
      ? await update()
      : await passkeyStatement(update);
    if (updated.modifiedCount !== 1) {
      return COUNTER_OUTCOME.ALREADY_ADVANCED;
    }

    document.counter = use.counter;
    document.lastUsedAt = use.usedAt;
    return COUNTER_OUTCOME.ADVANCED;
  }

  async markUsed(
    passkey: StoredPasskey,
    usedAt: Date,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    const document = documentOf(passkey);
    const update = () =>
      this.passkeyModel.updateOne(
        { _id: document._id },
        { $set: { lastUsedAt: usedAt } },
        unitOfWork ? { session: mongoSessionOf(unitOfWork) } : undefined,
      );
    if (unitOfWork) await update();
    else await passkeyStatement(update);
    document.lastUsedAt = usedAt;
  }

  async listForAccount(userId: string): Promise<StoredPasskey[]> {
    toObjectId(userId);
    const passkeys = await passkeyStatement(() =>
      this.passkeyModel.find({ user: userId }).sort({ createdAt: -1 }),
    );
    return passkeys.map(toStoredPasskey);
  }

  async findOwned(
    userId: string,
    passkeyId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<StoredPasskey | null> {
    toObjectId(userId);
    toObjectId(passkeyId);
    const owned = { _id: passkeyId, user: userId };
    const passkey = unitOfWork
      ? await this.passkeyModel.findOne(owned, null, {
          session: mongoSessionOf(unitOfWork),
        })
      : await passkeyStatement(() => this.passkeyModel.findOne(owned));
    return passkey ? toStoredPasskey(passkey) : null;
  }

  async rename(passkey: StoredPasskey, name: string): Promise<StoredPasskey> {
    const document = documentOf(passkey);
    document.name = name;
    await passkeyStatement(() => document.save());
    return toStoredPasskey(document);
  }

  async remove(unitOfWork: UnitOfWork, passkey: StoredPasskey): Promise<void> {
    const document = documentOf(passkey);
    await this.passkeyModel
      .deleteOne({ _id: document._id })
      .session(mongoSessionOf(unitOfWork));
  }

  async countForAccount(userId: string): Promise<number> {
    toObjectId(userId);
    return passkeyStatement(() =>
      this.passkeyModel.countDocuments({ user: userId }),
    );
  }
}

/** The stored id for an opaque one. An id Mongoose could not cast is refused. */
function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new MalformedIdError();
  }
  return new Types.ObjectId(id);
}
