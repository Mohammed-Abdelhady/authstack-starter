import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { MongoActivationAccounts } from '../../../auth/persistence/mongo/mongo-activation-accounts';
import { MongoMagicLinkAccounts } from '../../../auth/magic-link/persistence/mongo/mongo-magic-link-accounts'; // feature:magic-link
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

  /** A document written before accounts had a language, with no field at all. */
  async function storeWithoutLanguage(email: string): Promise<void> {
    await users.collection.insertOne({
      email,
      name: 'Stored',
      role: 'user',
      isDeleted: false,
    });
  }

  it('stores en for an account created without a language', async () => {
    await users.create({ email: 'new@example.test', name: 'New' });

    const raw = await users.collection.findOne({ email: 'new@example.test' });

    expect(raw?.locale).toBe('en');
  });

  it('reads a document with no language as en, wherever it is read', async () => {
    await storeWithoutLanguage('before@example.test');

    const document = await users.findOne({ email: 'before@example.test' });
    expect({
      record: document ? toStoredAccount(document).locale : null,
      owner: (
        await new MongoActivationAccounts(users).findAddressOwner(
          'before@example.test',
        )
      )?.locale,
      // feature:magic-link:start
      linkRecipient: (
        await new MongoMagicLinkAccounts(users).findLinkRecipient(
          'before@example.test',
        )
      )?.locale,
      // feature:magic-link:end
    }).toEqual({
      record: 'en',
      owner: 'en',
      linkRecipient: 'en', // feature:magic-link
    });
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
