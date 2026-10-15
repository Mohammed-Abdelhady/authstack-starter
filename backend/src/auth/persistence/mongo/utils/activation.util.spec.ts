import {
  ClientSession,
  Connection,
  Model,
  Types,
  createConnection,
} from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ADDRESS_CLAIM_KIND } from '../../../../common/persistence/address-ledger';
import {
  AddressClaim,
  AddressClaimSchema,
} from '../../../../common/persistence/mongo/schemas/address-claim.schema';
import { AccountCreationPolicy } from '../../../services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../../constants/account-creation';
import { WEB_CLIENT_ID } from '../../../../session/constants/client-ids';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import {
  createActivatedAccount,
  confirmEmailChange,
} from '../../../../../test/utils/auth/mongo-activation';
import { withMajorityTransaction } from '../../../../common/persistence/mongo/mongo-transaction';
import { PENDING_PURPOSE } from '../../../constants/registration';
import { ReservedCode } from '../../../interfaces/pending-code.interface';
import {
  startMemoryReplSet,
  MemoryReplSet,
} from '../../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';

function signupReserved(email: string): ReservedCode {
  return {
    id: new Types.ObjectId(),
    email,
    purpose: PENDING_PURPOSE.SIGNUP,
    hashedCode: 'hashed-code',
  };
}

describe('activation account writes', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(
      mongo.uri('activation_util'),
    ).asPromise();
    await connection.model(AddressClaim.name, AddressClaimSchema).init();
    const model = connection.model<User>(User.name, UserSchema);
    const module: TestingModule = await Test.createTestingModule({
      providers: [{ provide: getModelToken(User.name), useValue: model }],
    }).compile();
    users = module.get<Model<UserDocument>>(getModelToken(User.name));
    await users.init();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await connection.model(AddressClaim.name).deleteMany({});
    await users.deleteMany({});
  });

  it('creates the account a verified sign-up code describes', async () => {
    const policy = new AccountCreationPolicy();
    const check = jest.spyOn(policy, 'assertMayCreate');
    let creatingSession: ClientSession | undefined;
    const user = await withMajorityTransaction(connection, (session) => {
      creatingSession = session;
      return createActivatedAccount(
        signupReserved('new@example.com'),
        'hashed-password',
        'New User',
        users,
        session,
        new Types.ObjectId(),
        policy,
      );
    });

    expect(check).toHaveBeenCalledTimes(1);
    const [request, work] = check.mock.calls[0];
    expect(request).toEqual({
      application: WEB_CLIENT_ID,
      method: ACCOUNT_CREATION_METHOD.PASSWORD,
    });
    expect(mongoSessionOf(work)).toBe(creatingSession);
    const stored = await users.findById(user._id).select('+password');
    expect(stored?.email).toBe('new@example.com');
    expect(stored?.password).toBe('hashed-password');
    expect(stored?.name).toBe('New User');
    expect(stored?.isVerified).toBe(true);
    expect(stored?.authProvider).toBe(AuthProvider.EMAIL);
  });

  it('refuses a sign-up aimed at an address that already has an account', async () => {
    await users.create({ email: 'taken@example.com', name: 'Taken' });

    await expect(
      withMajorityTransaction(connection, (session) =>
        createActivatedAccount(
          signupReserved('taken@example.com'),
          'hashed-password',
          'Second',
          users,
          session,
          new Types.ObjectId(),
        ),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });

    const stored = await users.findOne({ email: 'taken@example.com' });
    expect(stored?.name).toBe('Taken');
  });

  it('verifies the moved address when the record still matches the target', async () => {
    const target = await users.create({
      email: 'old@example.com',
      pendingEmail: 'new@example.com',
      name: 'Target',
      isVerified: true,
      addressGeneration: 2,
    });
    await connection.model(AddressClaim.name).create({
      _id: 'new@example.com',
      owner: target._id.toString(),
      kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
      lapsesAt: new Date('2099-01-01T12:15:00.000Z'),
    });

    await withMajorityTransaction(connection, (session) =>
      confirmEmailChange(
        {
          id: new Types.ObjectId(),
          email: 'new@example.com',
          purpose: PENDING_PURPOSE.EMAIL_CHANGE,
          hashedCode: 'hashed-code',
          userId: target._id,
          addressGeneration: 2,
        },
        users,
        session,
      ),
    );

    const stored = await users.findById(target._id);
    expect(stored?.email).toBe('new@example.com');
    expect(stored?.pendingEmail).toBeUndefined();
    expect(stored?.isVerified).toBe(true);
  });

  it('refuses a code for a different address at the same generation', async () => {
    const target = await users.create({
      email: 'old@example.com',
      pendingEmail: 'current@example.com',
      name: 'Target',
      isVerified: true,
      addressGeneration: 2,
    });

    await expect(
      withMajorityTransaction(connection, (session) =>
        confirmEmailChange(
          {
            id: new Types.ObjectId(),
            email: 'stale@example.com',
            purpose: PENDING_PURPOSE.EMAIL_CHANGE,
            hashedCode: 'hashed-code',
            userId: target._id,
            addressGeneration: 2,
          },
          users,
          session,
        ),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });

    const stored = await users.findById(target._id);
    expect(stored?.email).toBe('old@example.com');
    expect(stored?.pendingEmail).toBe('current@example.com');
  });

  it('refuses a stale address change and confirms nothing', async () => {
    const target = await users.create({
      email: 'new@example.com',
      name: 'Target',
      isVerified: false,
      addressGeneration: 3,
    });

    await expect(
      withMajorityTransaction(connection, (session) =>
        confirmEmailChange(
          {
            id: new Types.ObjectId(),
            email: 'new@example.com',
            purpose: PENDING_PURPOSE.EMAIL_CHANGE,
            hashedCode: 'hashed-code',
            userId: target._id,
            addressGeneration: 2,
          },
          users,
          session,
        ),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });

    const stored = await users.findById(target._id);
    expect(stored?.isVerified).toBe(false);
  });
});
