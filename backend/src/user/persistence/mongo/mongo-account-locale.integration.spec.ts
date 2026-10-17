import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { toStoredAccount } from './mongo-account-records';
import { User, UserDocument, UserSchema } from './schemas/user.schema';

describe('the language of a MongoDB account', () => {
  let mongo: MemoryReplSet | undefined;
  let connection: Connection | undefined;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    connection.model(User.name, UserSchema);
    users = connection.model<UserDocument>(User.name);
    await users.init();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await users.deleteMany({});
  });

  it('reads a language this build does not carry as en', async () => {
    await users.create({
      email: 'elsewhere@example.test',
      name: 'Elsewhere',
      locale: 'xx',
    });

    const document = await users.findOne({ email: 'elsewhere@example.test' });

    expect(document ? toStoredAccount(document).locale : null).toBe('en');
  });
});
