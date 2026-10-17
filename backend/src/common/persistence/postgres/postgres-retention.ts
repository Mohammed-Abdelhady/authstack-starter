import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { sql } from 'kysely';
import { describeDriverError } from '../../utils/describe-error.util';
import { MAGIC_LINK_RETENTION_SECONDS } from '../../../auth/magic-link/constants/magic-link.constants'; // feature:magic-link
import { NODE_TIMERS, OwnedSchedule, ScheduleTimers } from './owned-schedule';
import { PostgresDatabase } from './postgres-connection';
import { PostgresTables } from './postgres-database';

const MS_PER_SECOND = 1000;
const logger = new Logger('PostgresRetention');

/** A table whose rows stop being needed some time after one of its columns. */
export interface RetentionRule {
  table: keyof PostgresTables;
  /** The column that says when the row stopped being valid. */
  column: string;
  /** How long a row is kept after that, for what still reads it. */
  keepForMs: number;
}

/**
 * Every table whose rows expire, with how long each is kept. How long
 * a row is kept is a separate matter from when it stops being valid: no check
 * of a code, a proof, a token or a session reads this list or waits for this
 * job. Each compares the expiry itself, so a row this job has not reached yet
 * is refused exactly as one it has removed.
 */
export const RETENTION_RULES: readonly RetentionRule[] = [
  { table: 'address_claims', column: 'lapses_at', keepForMs: 0 },
  { table: 'mail_counters', column: 'expires_at', keepForMs: 0 },
  { table: 'pending_registrations', column: 'expires_at', keepForMs: 0 },
  { table: 'pending_password_resets', column: 'expires_at', keepForMs: 0 },
  // feature:magic-link:start
  {
    // Kept an hour longer, for the hourly count of requested links.
    table: 'pending_magic_links',
    column: 'expires_at',
    keepForMs: MAGIC_LINK_RETENTION_SECONDS * MS_PER_SECOND,
  },
  // feature:magic-link:end
  { table: 'browser_proofs', column: 'expires_at', keepForMs: 0 },
  { table: 'two_factor_challenges', column: 'expires_at', keepForMs: 0 }, // feature:totp
  { table: 'passkey_challenges', column: 'expires_at', keepForMs: 0 }, // feature:passkeys
  { table: 'authorization_transactions', column: 'expires_at', keepForMs: 0 },
  { table: 'native_attempts', column: 'expires_at', keepForMs: 0 },
  { table: 'email_codes', column: 'purge_after', keepForMs: 0 }, // feature:email-code
  { table: 'native_credentials', column: 'expires_at', keepForMs: 0 },
  { table: 'native_dpop_proof_ids', column: 'expires_at', keepForMs: 0 },
  { table: 'sessions', column: 'expires_at', keepForMs: 0 },
  { table: 'security_events', column: 'purge_after', keepForMs: 0 },
  { table: 'erasure_jobs', column: 'purge_after', keepForMs: 0 },
  { table: 'account_deletion_receipts', column: 'purge_after', keepForMs: 0 },
  { table: 'provider_revocations', column: 'purge_after', keepForMs: 0 }, // feature:oauth-core
  { table: 'provider_link_tickets', column: 'expires_at', keepForMs: 0 }, // feature:oauth-core
  { table: 'session_proofs', column: 'purge_after', keepForMs: 0 },
  { table: 'staff_idempotency_keys', column: 'expires_at', keepForMs: 0 },
];

/** Rows one statement removes at most. */
export const RETENTION_BATCH_ROWS = 500;
/** Statements one run sends to one table at most. The rest waits for the next run. */
export const RETENTION_BATCHES_PER_RUN = 20;
export const RETENTION_INTERVAL_MS = 5 * 60 * MS_PER_SECOND;

export interface RetentionLimits {
  batchRows: number;
  batchesPerRun: number;
}

const DEFAULT_LIMITS: RetentionLimits = {
  batchRows: RETENTION_BATCH_ROWS,
  batchesPerRun: RETENTION_BATCHES_PER_RUN,
};

/**
 * Removes one batch of rows past the cutoff and answers how many went. The
 * rows are picked by their place in the table, so a row another statement
 * changed in between is a new version and is left alone.
 */
async function removeBatch(
  database: PostgresDatabase,
  rule: RetentionRule,
  cutoff: Date,
  batchRows: number,
): Promise<number> {
  const table = sql.table(rule.table);
  const removed = await sql`
    DELETE FROM ${table}
     WHERE ctid = ANY (ARRAY(
       SELECT ctid FROM ${table}
        WHERE ${sql.ref(rule.column)} <= ${cutoff}
        LIMIT ${batchRows}
     ))`.execute(database);
  return Number(removed.numAffectedRows ?? 0n);
}

export interface RetentionPass {
  /** Rows removed, by table. A table the pass did not reach is absent. */
  removed: Record<string, number>;
  /** Tables whose statement failed. The pass went on to the next table. */
  failed: string[];
}

/**
 * One pass over every rule, in bounded batches. Each rule stands alone: a
 * table whose statement fails is named in `failed`, logged, and the pass goes
 * on, so one broken table never keeps the others from being cleaned. A table
 * with more expired rows than one run may take keeps the rest for the next
 * run. `stopping` is asked before every statement, so a pass ends after the
 * statement in flight when the server is shutting down.
 */
export async function removeExpiredRows(
  database: PostgresDatabase,
  now: Date,
  limits: RetentionLimits = DEFAULT_LIMITS,
  rules: readonly RetentionRule[] = RETENTION_RULES,
  stopping: () => boolean = () => false,
): Promise<RetentionPass> {
  const pass: RetentionPass = { removed: {}, failed: [] };
  for (const rule of rules) {
    if (stopping()) break;
    const cutoff = new Date(now.getTime() - rule.keepForMs);
    let total = 0;
    try {
      for (let batch = 0; batch < limits.batchesPerRun; batch += 1) {
        if (stopping()) break;
        const rows = await removeBatch(
          database,
          rule,
          cutoff,
          limits.batchRows,
        );
        total += rows;
        if (rows < limits.batchRows) break;
      }
    } catch (error) {
      pass.failed.push(rule.table);
      logger.error(
        `Retention failed for ${rule.table}: ${describeDriverError(error)}`,
      );
    }
    pass.removed[rule.table] = total;
  }
  return pass;
}

/**
 * Owns the one schedule that removes expired rows. It starts once the
 * application has booted and stops when the module is destroyed, before the
 * pool is ended. A run that fails is logged and the next one tries again.
 */
export class PostgresRetentionJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly schedule: OwnedSchedule;

  constructor(
    database: PostgresDatabase,
    clock: { now(): Date },
    timers: ScheduleTimers = NODE_TIMERS,
  ) {
    this.schedule = new OwnedSchedule(
      'PostgresRetention',
      RETENTION_INTERVAL_MS,
      async () => {
        await removeExpiredRows(
          database,
          clock.now(),
          undefined,
          undefined,
          () => this.schedule.isStopped,
        );
      },
      timers,
    );
  }

  onApplicationBootstrap(): void {
    this.schedule.start();
  }

  /** One pass now, or the pass already going. */
  runOnce(): Promise<void> {
    return this.schedule.runOnce();
  }

  async onModuleDestroy(): Promise<void> {
    await this.schedule.stop();
  }
}
