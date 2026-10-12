import { Kysely, sql } from 'kysely';
import {
  MAIL_COUNTER_CONSTRAINT,
  MAIL_RECORD,
  MailCounterKey,
  MailCounterStore,
  MailRecord,
  MailWindowRule,
} from '../../pending-codes/mail-counter.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import {
  autocommit,
  removedRows,
  storedAddress,
} from './postgres-pending-codes-database';

const CONSTRAINTS = {
  mail_counter_email_purpose_unique: MAIL_COUNTER_CONSTRAINT.ADDRESS_PURPOSE,
} as const;

const NONE = {} as const;

export class PostgresMailCounterStore extends MailCounterStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  /**
   * One UPDATE: every right-hand side reads the row as it was, and a second
   * writer that waited on the row checks the cap again on the new version.
   */
  recordWithinCap(
    key: MailCounterKey,
    rule: MailWindowRule,
  ): Promise<MailRecord> {
    const rolledOverBefore = new Date(rule.now.getTime() - rule.windowMs);
    const windowStart = sql<Date>`CASE WHEN window_started_at <= ${rolledOverBefore} THEN ${rule.now}::timestamptz ELSE window_started_at END`;
    return autocommit(NONE, async () => {
      const updated = await this.database
        .updateTable('mail_counters')
        .set({
          mailed_codes: sql<number>`CASE WHEN window_started_at <= ${rolledOverBefore} THEN 1 ELSE mailed_codes + 1 END`,
          window_started_at: windowStart,
          // Never earlier than the guess count on this row is still needed.
          expires_at: sql<Date>`GREATEST(${windowStart} + ${rule.windowMs} * interval '1 millisecond', guess_state_expires_at)`,
        })
        .where('email', '=', storedAddress(key.email))
        .where('purpose', '=', key.purpose)
        .where((where) =>
          where.or([
            where('window_started_at', '<=', rolledOverBefore),
            where('mailed_codes', '<', rule.limit),
          ]),
        )
        .returning('id')
        .executeTakeFirst();
      return updated ? MAIL_RECORD.RECORDED : MAIL_RECORD.NOT_RECORDED;
    });
  }

  hasCounter(key: MailCounterKey): Promise<boolean> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .selectFrom('mail_counters')
        .select('id')
        .where('email', '=', storedAddress(key.email))
        .where('purpose', '=', key.purpose)
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  async openCounter(
    key: MailCounterKey,
    window: { now: Date; windowMs: number },
  ): Promise<void> {
    await autocommit(CONSTRAINTS, () =>
      this.database
        .insertInto('mail_counters')
        .values({
          email: storedAddress(key.email),
          purpose: key.purpose,
          mailed_codes: 1,
          window_started_at: window.now,
          expires_at: new Date(window.now.getTime() + window.windowMs),
        })
        .execute(),
    );
  }

  deleteExpiredBefore(cutoff: Date): Promise<number> {
    return autocommit(NONE, async () =>
      removedRows(
        await this.database
          .deleteFrom('mail_counters')
          .where('expires_at', '<=', cutoff)
          .executeTakeFirstOrThrow(),
      ),
    );
  }
}
