// feature:passkeys:start
import { sql } from 'kysely';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PasskeyResetStore } from '../../passkey-reset/passkey-reset.store';

export class PostgresPasskeyResetStore extends PasskeyResetStore {
  async removeAll(work: UnitOfWork, userId: string): Promise<void> {
    await sql`UPDATE users SET version = version + 1 WHERE id = ${userId}`.execute(
      postgresTransactionOf(work),
    );
    await postgresTransactionOf(work)
      .deleteFrom('passkeys')
      .where('user_id', '=', userId)
      .execute();
  }
}

export const POSTGRES_PASSKEY_RESET_PROVIDER = {
  provide: PasskeyResetStore,
  useClass: PostgresPasskeyResetStore,
};
// feature:passkeys:end
