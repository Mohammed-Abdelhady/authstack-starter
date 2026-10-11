import {
  openTestConnection,
  TestConnection,
} from '../../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/postgres/server/postgres-test-server';
import {
  createResponseMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import {
  PostgresMagicLinkAccounts,
  PostgresMagicLinkSignIn,
} from './postgres-magic-link.store';

describe('PostgresMagicLinkSignIn', () => {
  let connection: TestConnection | undefined;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it('finishes the sign-in of the account a link named as one a magic link opened', async () => {
    if (!connection) throw new Error('the PostgreSQL connection did not open');
    const { database } = connection;
    const stored = await database
      .insertInto('users')
      .values({
        email: 'linked@example.test',
        name: 'Link Tester',
        is_verified: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const account = await new PostgresMagicLinkAccounts(database).findByEmail(
      'linked@example.test',
    );
    if (!account) throw new Error('the seeded account was not read');
    const completeSignIn = jest
      .fn()
      .mockResolvedValue({ requiresTwoFactor: true });
    const signIn = new PostgresMagicLinkSignIn(
      partialMock<SignInCompletion>({ completeSignIn }),
    );
    const response = createResponseMock({});

    const outcome = await signIn.complete(account, response);

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(completeSignIn.mock.calls).toEqual([
      [
        expect.objectContaining({
          id: stored.id,
          email: 'linked@example.test',
        }),
        response,
        'magic_link', // feature:totp
      ],
    ]);
  });
});
