import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { createConnection, Model } from 'mongoose';
import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import { MONGO_TRANSIENT_TRANSACTION_LABEL } from '../../../src/common/constants/mongo-errors';
import { MONGO_COMMON_PROVIDERS } from '../../../src/common/persistence/mongo/mongo-common-persistence';
import {
  AddressClaim,
  AddressClaimDocument,
  AddressClaimSchema,
} from '../../../src/common/persistence/mongo/schemas/address-claim.schema';
import {
  MongoUnitOfWorkRunner,
  mongoSessionOf,
} from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../src/user/persistence/mongo/schemas/user.schema';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import { RaceGate } from '../race-gate';
import { startMemoryReplSet } from '../memory-replset';
import { AddressLedgerHarness } from './address-ledger-harness';

export async function bootMongoAddressLedgerHarness(): Promise<AddressLedgerHarness> {
  const mongo = await startMemoryReplSet();
  const connection = createConnection(mongo.uri('address_ledger_contract'));
  let module: TestingModule | undefined;
  const close = async (): Promise<void> => {
    try {
      await module?.close();
    } finally {
      try {
        await connection.close();
      } finally {
        await mongo.stop();
      }
    }
  };
  try {
    await connection.asPromise();
    const claims = connection.model(AddressClaim.name, AddressClaimSchema);
    const users = connection.model(User.name, UserSchema);
    await Promise.all([claims.init(), users.init()]);
    module = await Test.createTestingModule({
      providers: [
        ...MONGO_COMMON_PROVIDERS,
        { provide: getModelToken(AddressClaim.name), useValue: claims },
        { provide: getModelToken(User.name), useValue: users },
      ],
    }).compile();
    const userModel = module.get<Model<UserDocument>>(getModelToken(User.name));
    const claimModel = module.get<Model<AddressClaimDocument>>(
      getModelToken(AddressClaim.name),
    );
    return {
      ledger: module.get(AddressLedger),
      clock: new FrozenClock(TEST_NOW),
      runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),
      retryableAbort: () =>
        Object.assign(new Error('simulated abort'), {
          errorLabels: [MONGO_TRANSIENT_TRANSACTION_LABEL],
        }),
      claims: async () => {
        const rows = await claimModel.find({}).sort({ _id: 1 }).lean().exec();
        return rows.map((row) => ({
          address: row._id,
          kind: row.kind,
          owner: row.owner,
          lapsesAt: row.lapsesAt,
        }));
      },
      accounts: async () => {
        const rows = await userModel.find({}).sort({ email: 1 }).lean().exec();
        return rows.map((row) => ({
          email: row.email,
          deleted: row.isDeleted,
        }));
      },
      seedClaim: async (input) => {
        await claimModel.create({
          _id: input.address,
          kind: input.kind,
          owner: input.owner,
          lapsesAt: input.lapsesAt,
        });
      },
      seedAccount: async (email, deleted = false) => {
        const row = await userModel.create({
          email,
          name: 'Ledger account',
          isDeleted: deleted,
        });
        return row._id.toString();
      },
      insertAccount: async (uow, email) => {
        const row = new userModel({ email, name: 'Reserved account' });
        await row.save({ session: mongoSessionOf(uow) });
        return row._id.toString();
      },
      contention: (afterCommit) => {
        const blocked = new RaceGate();
        return {
          runner: new MongoUnitOfWorkRunner(connection, async () => {
            blocked.release();
            await afterCommit;
          }),
          blocked: () => blocked.hold(),
          stop: () => blocked.release(),
        };
      },
      reset: async () => {
        await claimModel.deleteMany({}).exec();
        await userModel.deleteMany({}).exec();
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
