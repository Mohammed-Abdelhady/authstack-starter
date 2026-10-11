import { Model, Types } from 'mongoose';
import {
  createModelMock,
  createResponseMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';
import { UserDocument } from '../../../../user/persistence/mongo/schemas/user.schema';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import {
  MongoPasskeyAccounts,
  MongoPasskeySignIn,
} from './mongo-passkey-accounts';

const USER_ID = '507f1f77bcf86cd799439011';

describe('MongoPasskeySignIn', () => {
  it('finishes the sign-in of a passkey that did not verify its user as one a passkey opened', async () => {
    const document = partialMock<UserDocument>({
      _id: new Types.ObjectId(USER_ID),
      email: 'user@example.com',
      name: 'Test User',
      isDeleted: false,
    });
    const accounts = new MongoPasskeyAccounts(
      createModelMock<Model<UserDocument>>({
        findById: jest.fn().mockResolvedValue(document),
      }),
    );
    const completeSignIn = jest
      .fn()
      .mockResolvedValue({ requiresTwoFactor: true });
    const signIn = new MongoPasskeySignIn(
      partialMock<SignInService>({ completeSignIn }),
    );
    const response = createResponseMock({});
    const account = await accounts.findAccount(USER_ID);
    if (!account) throw new Error('the account was not read');

    const outcome = await signIn.completeSignIn(account, response);

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(completeSignIn.mock.calls).toEqual([
      [
        document,
        response,
        'passkey', // feature:totp
      ],
    ]);
  });
});
