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

const SIGNED_IN = {
  requiresTwoFactor: false as const,
  user: { id: USER_ID, email: 'user@example.com', name: 'Test User' },
};

const VERIFIED_PASSKEY = {
  authenticationMethods: ['passkey'],
  userVerified: true,
};

async function readAccount(document: UserDocument) {
  const accounts = new MongoPasskeyAccounts(
    createModelMock<Model<UserDocument>>({
      findById: jest.fn().mockResolvedValue(document),
    }),
  );
  const account = await accounts.findAccount(USER_ID);
  if (!account) throw new Error('the account was not read');
  return account;
}

describe('MongoPasskeySignIn', () => {
  const document = partialMock<UserDocument>({
    _id: new Types.ObjectId(USER_ID),
    email: 'user@example.com',
    name: 'Test User',
    isDeleted: false,
  });

  it.each([
    ['a sign-in held for the second step', { requiresTwoFactor: true }],
    ['a finished sign-in', SIGNED_IN],
  ])(
    'finishes the sign-in of a passkey that did not verify its user as one a passkey opened, and hands back %s',
    async (_label, answer) => {
      const completeSignIn = jest.fn().mockResolvedValue(answer);
      const issueSession = jest.fn();
      const signIn = new MongoPasskeySignIn(
        partialMock<SignInService>({ completeSignIn, issueSession }),
      );
      const response = createResponseMock({});

      const outcome = await signIn.completeSignIn(
        await readAccount(document),
        response,
      );

      expect(outcome).toBe(answer);
      expect(completeSignIn.mock.calls).toEqual([
        [document, response, 'passkey'],
      ]);
      expect(issueSession).not.toHaveBeenCalled();
    },
  );

  it('issues the session of a passkey that verified its user with no second step', async () => {
    const completeSignIn = jest.fn();
    const issueSession = jest.fn().mockResolvedValue(SIGNED_IN.user);
    const signIn = new MongoPasskeySignIn(
      partialMock<SignInService>({ completeSignIn, issueSession }),
    );
    const response = createResponseMock({});

    const user = await signIn.issueSession(
      await readAccount(document),
      response,
      VERIFIED_PASSKEY,
    );

    expect(user).toBe(SIGNED_IN.user);
    expect(issueSession.mock.calls).toEqual([
      [document, response, VERIFIED_PASSKEY],
    ]);
    expect(completeSignIn).not.toHaveBeenCalled();
  });
});
