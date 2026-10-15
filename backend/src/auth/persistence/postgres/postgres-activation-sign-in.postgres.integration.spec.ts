import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { PostgresUnitOfWorkRunner } from '../../../common/persistence/postgres/postgres-unit-of-work';
import {
  createResponseMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import {
  PostgresActivationAccounts,
  PostgresActivationSignIn,
} from './postgres-activation-accounts';

describe('PostgresActivationSignIn', () => {
  let connection: TestConnection | undefined;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it('finishes the sign-in of an activated account as one the mailed code opened', async () => {
    if (!connection) throw new Error('the PostgreSQL connection did not open');
    const { database } = connection;
    const accounts = new PostgresActivationAccounts(
      database,
      new FrozenClock(TEST_NOW),
    );
    const id = accounts.newAccountId();
    const account = await new PostgresUnitOfWorkRunner(database).run(
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
    const signIn = new PostgresActivationSignIn(
      partialMock<SignInCompletion>({ completeSignIn }),
    );
    const response = createResponseMock({});

    const outcome = await signIn.complete(account, response);

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(completeSignIn.mock.calls).toEqual([
      [
        expect.objectContaining({ id, email: 'activated@example.test' }),
        response,
        'email_code',
      ],
    ]);
  });
});
