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

describe('PostgresPasskeySignIn', () => {
  it('finishes the sign-in of a passkey that did not verify its user as one a passkey opened', async () => {
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
    const completeSignIn = jest
      .fn()
      .mockResolvedValue({ requiresTwoFactor: true });
    const signIn = new PostgresPasskeySignIn(
      partialMock<SignInCompletion>({ completeSignIn }),
    );
    const response = createResponseMock({});

    const outcome = await signIn.completeSignIn(account, response);

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(completeSignIn.mock.calls).toEqual([
      [
        stored,
        response,
        'passkey', // feature:totp
      ],
    ]);
  });
});
