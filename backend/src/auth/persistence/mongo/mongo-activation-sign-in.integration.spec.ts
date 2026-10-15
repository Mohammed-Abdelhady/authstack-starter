import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import {
  createResponseMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  MongoActivationAccounts,
  MongoActivationSignIn,
} from './mongo-activation-accounts';
import { SignInService } from './sign-in.service';

describe('MongoActivationSignIn', () => {
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

  it('finishes the sign-in of an activated account as one the mailed code opened', async () => {
    if (!connection) throw new Error('the MongoDB connection did not open');
    const accounts = new MongoActivationAccounts(users);
    const id = accounts.newAccountId();
    const account = await new MongoUnitOfWorkRunner(connection).run(
      (unitOfWork) =>
        accounts.insertActivated(unitOfWork, {
          audience: undefined,
          id,
          email: 'activated@example.test',
          passwordHash: 'a-stored-password-hash',
          name: 'Activated Tester',
          locale: 'en',
        }),
    );
    const completeSignIn = jest
      .fn()
      .mockResolvedValue({ requiresTwoFactor: true });
    const signIn = new MongoActivationSignIn(
      partialMock<SignInService>({ completeSignIn }),
    );
    const response = createResponseMock({});

    const outcome = await signIn.complete(account, response);

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(completeSignIn.mock.calls).toEqual([
      [
        expect.objectContaining({ email: 'activated@example.test' }),
        response,
        'email_code',
      ],
    ]);
    expect(await users.countDocuments({ _id: id })).toBe(1);
  });
});
