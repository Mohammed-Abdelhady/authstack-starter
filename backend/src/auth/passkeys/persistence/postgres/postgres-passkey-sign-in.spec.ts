import {
  createResponseMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';
import { rememberSignInAccount } from '../../../persistence/postgres/postgres-sign-in-accounts';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { SignInAccount } from '../../../utils/authenticated-user.util';
import { PasskeyAccount } from '../../stores/passkey-accounts';
import { PostgresPasskeySignIn } from './postgres-passkey.store';

const USER_ID = '018f4e2a-7b3c-7d10-9a5e-2c4b6d8e0f1a';

const SIGNED_IN = {
  requiresTwoFactor: false as const,
  user: { id: USER_ID, email: 'user@example.com', name: 'Test User' },
};

describe('PostgresPasskeySignIn', () => {
  const stored = partialMock<SignInAccount>({
    id: USER_ID,
    email: 'user@example.com',
    name: 'Test User',
  });
  const account: PasskeyAccount = rememberSignInAccount(
    {
      id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      isDeleted: false,
    },
    stored,
  );

  it.each([
    ['a sign-in held for the second step', { requiresTwoFactor: true }],
    ['a finished sign-in', SIGNED_IN],
  ])(
    'finishes the sign-in of a passkey that did not verify its user as one a passkey opened, and hands back %s',
    async (_label, answer) => {
      const completeSignIn = jest.fn().mockResolvedValue(answer);
      const issueSession = jest.fn();
      const signIn = new PostgresPasskeySignIn(
        partialMock<SignInCompletion>({ completeSignIn, issueSession }),
      );
      const response = createResponseMock({});

      const outcome = await signIn.completeSignIn(account, response);

      expect(outcome).toBe(answer);
      expect(completeSignIn.mock.calls).toEqual([
        [
          stored,
          response,
          'passkey', // feature:totp
        ],
      ]);
      expect(issueSession).not.toHaveBeenCalled();
    },
  );

  it('issues the session of a passkey that verified its user with no second step', async () => {
    const completeSignIn = jest.fn();
    const issueSession = jest.fn().mockResolvedValue(SIGNED_IN.user);
    const signIn = new PostgresPasskeySignIn(
      partialMock<SignInCompletion>({ completeSignIn, issueSession }),
    );
    const response = createResponseMock({});

    const user = await signIn.issueSession(account, response);

    expect(user).toBe(SIGNED_IN.user);
    expect(issueSession.mock.calls).toEqual([[stored, response]]);
    expect(completeSignIn).not.toHaveBeenCalled();
  });
});
