import { Connection, createConnection, Model } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { MongoPasskeyAccounts } from './mongo-passkey-accounts';

/**
 * The interleaving the contract cannot hold still on both databases: a
 * registration has read the account, and a deactivation writes it before the
 * registration commits. The fence must make that deactivation conflict
 * instead of commit.
 */
describe('MongoPasskeyAccounts.readStanding fences the account', () => {
  let mongo: MemoryReplSet | undefined;
  let connection: Connection | undefined;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(
      mongo.uri('passkey_standing_fence'),
    ).asPromise();
    connection.model(User.name, UserSchema);
    users = connection.model<UserDocument>(User.name);
    await users.init();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('refuses a deactivation written while a registration holds the account, so no passkey lands after it', async () => {
    if (!connection) throw new Error('the connection did not open');
    const account = await users.create({
      email: 'fenced@example.test',
      name: 'Fenced',
      isVerified: true,
    });
    const userId = account._id.toString();
    const accounts = new MongoPasskeyAccounts(users);
    const deactivation = await connection.startSession();
    let deactivationOutcome = 'not tried';

    try {
      const standing = await new MongoUnitOfWorkRunner(connection).run(
        async (unitOfWork) => {
          const read = await accounts.readStanding(unitOfWork, userId);
          deactivation.startTransaction();
          deactivationOutcome = await users
            .updateOne(
              { _id: userId },
              { $set: { isDeleted: true } },
              { session: deactivation },
            )
            .exec()
            .then(
              () => 'written',
              (error: { codeName?: string }) => error.codeName ?? 'failed',
            );
          await deactivation.abortTransaction().catch(() => undefined);
          return read;
        },
      );

      expect(standing).toEqual({ isDeleted: false });
      expect(deactivationOutcome).toBe('WriteConflict');
      const stored = await users.findById(userId).exec();
      expect(Boolean(stored?.isDeleted)).toBe(false);
    } finally {
      await deactivation.endSession();
    }
  });
});
