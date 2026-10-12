import { Kysely } from 'kysely';
import { EMAIL_PROVIDER } from '../../../common/constants/oauth-providers';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  HeldSignInMethods,
  SignInMethodStore,
} from '../../stores/sign-in-method.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

/**
 * The fence is the account's row lock, the one the other account workflows
 * take. A second unit of work is refused there at once (`NOWAIT`), which the
 * runner reports as a retryable abort. Everything is counted after the lock:
 * under read committed a count made before it could be stale by then.
 */
export class PostgresSignInMethodStore extends SignInMethodStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async holdForAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<HeldSignInMethods | null> {
    const work = postgresTransactionOf(unitOfWork);
    const account = await accountQuery(work, userId)
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return account ? waysInOf(work, account) : null;
  }

  async readForAccount(userId: string): Promise<HeldSignInMethods | null> {
    const account = await accountQuery(
      this.database,
      userId,
    ).executeTakeFirst();
    return account ? waysInOf(this.database, account) : null;
  }
}

/** The database, or the transaction a unit of work runs in. */
type Reader = Kysely<PostgresTables>;

interface AccountRow {
  id: string;
  auth_provider: string | null;
  password_hash: string | null;
}

function accountQuery(work: Reader, userId: string) {
  return work
    .selectFrom('users')
    .select(['id', 'auth_provider', 'password_hash'])
    .where('id', '=', toUuid(userId));
}

async function waysInOf(
  work: Reader,
  account: AccountRow,
): Promise<HeldSignInMethods> {
  const links = await work
    .selectFrom('user_linked_accounts')
    .select('provider')
    .where('user_id', '=', account.id)
    .orderBy('id')
    .execute();
  // feature:passkeys:start
  const passkeys = await work
    .selectFrom('passkeys')
    .select((select) => select.fn.countAll<string>().as('rows'))
    .where('user_id', '=', account.id)
    .executeTakeFirstOrThrow();
  // feature:passkeys:end

  return {
    emailSignIn: (account.auth_provider ?? EMAIL_PROVIDER) === EMAIL_PROVIDER,
    hasPassword: Boolean(account.password_hash),
    linkedProviders: links.map((link) => link.provider),
    passkeys: Number.parseInt(passkeys.rows, 10), // feature:passkeys
  };
}
