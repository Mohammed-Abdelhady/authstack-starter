import { createConnection } from 'mongoose';
import { MongoInvitationStore } from '../../../src/auth/invitations/persistence/mongo/mongo-invitation.store';
import {
  Invitation,
  InvitationDocument,
  InvitationSchema,
} from '../../../src/auth/invitations/persistence/mongo/invitation.schema';
import { MongoAddressLedger } from '../../../src/common/persistence/mongo/mongo-address-ledger';
import {
  AddressClaim,
  AddressClaimDocument,
  AddressClaimSchema,
} from '../../../src/common/persistence/mongo/schemas/address-claim.schema';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../src/user/persistence/mongo/schemas/user.schema';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import { startMemoryReplSet } from '../memory-replset';
import { RaceGate } from '../race-gate';
import type { InvitationHarness } from './invitation-harness';

export async function bootMongoInvitationHarness(): Promise<InvitationHarness> {
  const mongo = await startMemoryReplSet();
  const connection = createConnection(mongo.uri('invitation_contract'));
  const close = async (): Promise<void> => {
    try {
      await connection.close();
    } finally {
      await mongo.stop();
    }
  };
  try {
    await connection.asPromise();
    connection.model(Invitation.name, InvitationSchema);
    const invitations = connection.model<InvitationDocument>(Invitation.name);
    connection.model(AddressClaim.name, AddressClaimSchema);
    const claims = connection.model<AddressClaimDocument>(AddressClaim.name);
    connection.model(User.name, UserSchema);
    const users = connection.model<UserDocument>(User.name);
    await Promise.all([invitations.init(), claims.init(), users.init()]);
    return {
      store: new MongoInvitationStore(invitations, users),
      ledger: new MongoAddressLedger(claims, users),
      clock: new FrozenClock(TEST_NOW),
      runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),
      seedAccount: async (email) => {
        const user = await users.create({ email, name: 'Enrolment account' });
        return user._id.toString();
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
        await invitations.deleteMany({}).exec();
        await claims.deleteMany({}).exec();
        await users.deleteMany({}).exec();
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
