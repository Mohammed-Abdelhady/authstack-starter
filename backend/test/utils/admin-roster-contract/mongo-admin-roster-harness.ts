import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { createConnection } from 'mongoose';
import { AdminRosterStore } from '../../../src/admin/stores/admin-roster.store';
import { MONGO_ADMIN_ROSTER_STORE } from '../../../src/admin/persistence/mongo/mongo-admin-stores';
import {
  AdminRosterLock,
  AdminRosterLockSchema,
} from '../../../src/admin/persistence/mongo/admin-roster-lock.schema';
// feature:passkeys:start
import {
  Passkey,
  PasskeySchema,
} from '../../../src/auth/passkeys/persistence/mongo/schemas/passkey.schema'; // feature:passkeys
// feature:passkeys:end
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserSchema,
} from '../../../src/user/persistence/mongo/schemas/user.schema';
import { RaceGate } from '../race-gate';
import { startMemoryReplSet } from '../memory-replset';
import { AdminRosterHarness } from './admin-roster-harness';

export async function bootMongoAdminRosterHarness(): Promise<AdminRosterHarness> {
  const mongo = await startMemoryReplSet();
  const connection = createConnection(mongo.uri('admin_roster_contract'));
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
    const users = connection.model(User.name, UserSchema);
    const locks = connection.model(AdminRosterLock.name, AdminRosterLockSchema);
    const passkeys = connection.model(Passkey.name, PasskeySchema); // feature:passkeys
    await users.init();
    await locks.init();
    await passkeys.init(); // feature:passkeys
    module = await Test.createTestingModule({
      providers: [
        MONGO_ADMIN_ROSTER_STORE,
        { provide: getModelToken(User.name), useValue: users },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();
    let credentialSequence = 0; // feature:passkeys
    return {
      roster: module.get(AdminRosterStore),
      runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),
      seedAccount: async (input) => {
        const row = await users.create({
          email: input.email,
          name: 'Roster account',
          role: input.role ?? 'user',
          isDeleted: input.deleted ?? false,
          isVerified: input.verified ?? false,
          pendingEmail: input.pendingEmail,
        });
        return row._id.toString();
      },
      // feature:passkeys:start
      seedPasskey: async (userId, rpId) => {
        await passkeys.create({
          user: userId,
          rpId,
          credentialId: `roster-credential-${credentialSequence++}`,
          publicKey: Buffer.from([7, 7, 7]),
          name: 'Roster key',
        });
      },
      // feature:passkeys:end
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
        await users.deleteMany({}).exec();
        await locks.deleteMany({}).exec();
        await passkeys.deleteMany({}).exec(); // feature:passkeys
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
