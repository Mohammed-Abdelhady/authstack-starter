import { Connection, createConnection, Model } from 'mongoose';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  startMemoryReplSet,
  MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/hook-timeouts';

const WRITE_PATHS = {
  SAVE: 'save',
  CREATE: 'create',
  CREATE_IN_SESSION: 'create-in-session',
  ASSIGN_AND_SAVE: 'assign-and-save',
} as const;
type WritePath = (typeof WRITE_PATHS)[keyof typeof WRITE_PATHS];

describe('user email setters on MongoDB model writes', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.uri('email_setters')).asPromise();
    connection.model(User.name, UserSchema);
    users = connection.model<UserDocument>(User.name);
    await users.init();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await users.deleteMany({}).exec();
  });

  const write = async (path: WritePath, email: string): Promise<void> => {
    if (path === WRITE_PATHS.SAVE) {
      await new users({ email, name: 'New' }).save();
      return;
    }
    if (path === WRITE_PATHS.CREATE) {
      await users.create({ email, name: 'New' });
      return;
    }
    if (path === WRITE_PATHS.CREATE_IN_SESSION) {
      const session = await connection.startSession();
      try {
        await session.withTransaction(async () => {
          await users.create([{ email, name: 'New' }], { session });
        });
      } finally {
        await session.endSession();
      }
      return;
    }
    const target = await users.create({ email: 'old@x.com', name: 'Old' });
    target.email = email;
    await target.save();
  };

  const storedEmails = async (): Promise<string[]> =>
    (
      await users.collection
        .find<{ email: string }>({}, { projection: { email: 1, _id: 0 } })
        .sort({ email: 1 })
        .toArray()
    ).map((row) => row.email);

  // Each production write path must preserve the unique address hold.
  it.each(Object.values(WRITE_PATHS))(
    'L16 stores a normalised address and rejects its duplicate through %s',
    async (path) => {
      await write(path, ' A@X.com ');
      const stored = await storedEmails();
      const duplicateCode = await write(path, ' A@X.com ').then(
        () => null,
        (error: unknown) => {
          if (typeof error === 'object' && error !== null && 'code' in error) {
            return error.code;
          }
          throw error;
        },
      );
      expect({ stored, duplicateCode, after: await storedEmails() }).toEqual({
        stored: ['a@x.com'],
        duplicateCode: 11000,
        after:
          path === WRITE_PATHS.ASSIGN_AND_SAVE
            ? ['a@x.com', 'old@x.com']
            : ['a@x.com'],
      });
    },
  );
});
