import { Kysely, Selectable, sql } from 'kysely';
import { Clock } from '../../../common/services/clock';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import {
  EmailCodeKey,
  EmailCodeStore,
  NewEmailCode,
  StoredEmailCode,
  storedEmailCodePurpose,
} from '../../pending-codes/email-code.store';
import { autocommit, storedAddress } from './postgres-pending-codes-database';
import { EmailCodesTable } from './postgres-email-code.table';

const NONE = {} as const;

function toCode(row: Selectable<EmailCodesTable>): StoredEmailCode {
  return {
    ownerId: row.owner_id,
    purpose: storedEmailCodePurpose(row.purpose),
    email: row.email,
    codeHash: row.code_hash,
    wrongGuesses: row.wrong_guesses,
    expiresAt: row.expires_at,
    spentAt: row.spent_at,
  };
}

export class PostgresEmailCodeStore extends EmailCodeStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: Clock,
  ) {
    super();
  }

  put(code: NewEmailCode): Promise<StoredEmailCode> {
    const spentAt = code.spent ? this.clock.now() : null;
    return autocommit(NONE, async () => {
      const row = await this.database
        .insertInto('email_codes')
        .values({
          owner_id: code.ownerId,
          purpose: code.purpose,
          email: storedAddress(code.email),
          code_hash: code.codeHash,
          expires_at: code.expiresAt,
          spent_at: spentAt,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'purpose']).doUpdateSet((excluded) => ({
            email: excluded.ref('excluded.email'),
            code_hash: excluded.ref('excluded.code_hash'),
            expires_at: excluded.ref('excluded.expires_at'),
            spent_at: excluded.ref('excluded.spent_at'),
          })),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      return toCode(row);
    });
  }

  find(key: EmailCodeKey): Promise<StoredEmailCode | null> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .selectFrom('email_codes')
        .selectAll()
        .where('owner_id', '=', key.ownerId)
        .where('purpose', '=', key.purpose)
        .executeTakeFirst();
      return row ? toCode(row) : null;
    });
  }

  /** One UPDATE: the CASE reads the count as it was before this guess. */
  recordWrongGuess(key: EmailCodeKey, limit: number): Promise<number | null> {
    const now = this.clock.now();
    return autocommit(NONE, async () => {
      const row = await this.database
        .updateTable('email_codes')
        .set({
          wrong_guesses: sql<number>`wrong_guesses + 1`,
          spent_at: sql<Date | null>`CASE WHEN wrong_guesses + 1 >= ${limit} THEN COALESCE(spent_at, ${now}::timestamptz) ELSE spent_at END`,
        })
        .where('owner_id', '=', key.ownerId)
        .where('purpose', '=', key.purpose)
        .returning('wrong_guesses')
        .executeTakeFirst();
      return row ? row.wrong_guesses : null;
    });
  }

  async spendIn(
    unitOfWork: UnitOfWork,
    key: EmailCodeKey,
    code: { codeHash: string; limit: number },
  ): Promise<boolean> {
    const now = this.clock.now();
    const row = await postgresTransactionOf(unitOfWork)
      .updateTable('email_codes')
      .set({ spent_at: now })
      .where('owner_id', '=', key.ownerId)
      .where('purpose', '=', key.purpose)
      .where('code_hash', '=', code.codeHash)
      .where('spent_at', 'is', null)
      .where('expires_at', '>', now)
      .where('wrong_guesses', '<', code.limit)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }
}
