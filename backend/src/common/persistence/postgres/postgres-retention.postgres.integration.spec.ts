import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { FrozenClock } from '../../../../test/utils/frozen-clock';
import { HandTimers } from './hand-timers.harness-spec';
import { PostgresRetentionJob, removeExpiredRows } from './postgres-retention';

const NOW = new Date('2031-05-06T07:08:09.000Z');
const ONE_HOUR_MS = 3_600_000;
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

describe('PostgreSQL retention', () => {
  let connection: TestConnection;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await connection.reset();
  }, POSTGRES_RESET_TIMEOUT_MS);

  async function storeProof(name: string, expiresAt: Date): Promise<void> {
    await connection.database
      .insertInto('browser_proofs')
      .values({
        proof_id_hash: name,
        token_hash: randomUUID(),
        expires_at: expiresAt,
      })
      .execute();
  }

  async function proofsLeft(): Promise<string[]> {
    const rows = await connection.database
      .selectFrom('browser_proofs')
      .select('proof_id_hash')
      .orderBy('proof_id_hash')
      .execute();
    return rows.map((row) => row.proof_id_hash);
  }

  it('removes a row at its expiry and after it, and keeps one a millisecond before', async () => {
    await storeProof('expired-long-ago', at(-ONE_HOUR_MS));
    await storeProof('expired-just-now', at(0));
    await storeProof('expires-in-a-moment', at(1));

    const { removed } = await removeExpiredRows(connection.database, NOW);

    expect({
      removed: removed.browser_proofs,
      left: await proofsLeft(),
    }).toEqual({ removed: 2, left: ['expires-in-a-moment'] });
  });

  // feature:magic-link:start
  it('keeps a magic link for an hour after it stopped working, for the hourly count', async () => {
    const link = (name: string, expiresAt: Date) => ({
      email: `${name}@example.test`,
      token_hash: name,
      expires_at: expiresAt,
    });
    await connection.database
      .insertInto('pending_magic_links')
      .values([
        link('expired-an-hour-ago', at(-ONE_HOUR_MS)),
        link('expired-just-under-an-hour-ago', at(-ONE_HOUR_MS + 1)),
        link('expired-just-now', at(0)),
        link('still-works', at(ONE_HOUR_MS)),
      ])
      .execute();

    const { removed } = await removeExpiredRows(connection.database, NOW);
    const left = await connection.database
      .selectFrom('pending_magic_links')
      .select('token_hash')
      .orderBy('token_hash')
      .execute();

    expect({
      removed: removed.pending_magic_links,
      left: left.map((row) => row.token_hash),
    }).toEqual({
      removed: 1,
      left: [
        'expired-just-now',
        'expired-just-under-an-hour-ago',
        'still-works',
      ],
    });
  });
  // feature:magic-link:end

  it('removes an event when its retention ends, whenever it happened', async () => {
    const event = (name: string, purgeAfter: Date) => ({
      event_id: name,
      action: 'sign_in',
      outcome: 'success',
      occurred_at: at(-ONE_HOUR_MS),
      purge_after: purgeAfter,
    });
    await connection.database
      .insertInto('security_events')
      .values([event('retention-over', at(0)), event('retained', at(1))])
      .execute();

    const { removed } = await removeExpiredRows(connection.database, NOW);
    const left = await connection.database
      .selectFrom('security_events')
      .select('event_id')
      .execute();

    expect({
      removed: removed.security_events,
      left: left.map((row) => row.event_id),
    }).toEqual({ removed: 1, left: ['retained'] });
  });

  it('takes a bounded number of rows a run and leaves the rest for the next one', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await storeProof(`expired-${name}`, at(-1));
    }
    await storeProof('live', at(ONE_HOUR_MS));
    const limits = { batchRows: 2, batchesPerRun: 2 };

    const { removed: first } = await removeExpiredRows(
      connection.database,
      NOW,
      limits,
    );
    const afterFirst = (await proofsLeft()).length;
    const { removed: second } = await removeExpiredRows(
      connection.database,
      NOW,
      limits,
    );

    expect({
      first: first.browser_proofs,
      afterFirst,
      second: second.browser_proofs,
      left: await proofsLeft(),
    }).toEqual({ first: 4, afterFirst: 2, second: 1, left: ['live'] });
  });

  it('reads every table whose rows expire, and finds nothing in an empty database', async () => {
    expect((await removeExpiredRows(connection.database, NOW)).removed).toEqual(
      {
        mail_counters: 0,
        pending_registrations: 0,
        pending_password_resets: 0,
        pending_magic_links: 0, // feature:magic-link
        browser_proofs: 0,
        two_factor_challenges: 0, // feature:totp
        passkey_challenges: 0, // feature:passkeys
        authorization_transactions: 0,
        native_credentials: 0,
        native_dpop_proof_ids: 0,
        sessions: 0,
        security_events: 0,
      },
    );
  });

  it('cleans the tables after one whose statement fails, and names the one that failed', async () => {
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    await storeProof('expired', at(-1));

    const pass = await removeExpiredRows(connection.database, NOW, undefined, [
      { table: 'sessions', column: 'no_such_column', keepForMs: 0 },
      { table: 'browser_proofs', column: 'expires_at', keepForMs: 0 },
    ]);
    const logged = errors.mock.calls.map(([line]) => String(line));
    errors.mockRestore();

    expect({ pass, left: await proofsLeft(), logged }).toEqual({
      pass: {
        removed: { sessions: 0, browser_proofs: 1 },
        failed: ['sessions'],
      },
      left: [],
      logged: ['Retention failed for sessions: name=error code=42703'],
    });
  });

  it('ends a pass after the statement in flight once it is told to stop', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await storeProof(`expired-${name}`, at(-1));
    }
    let asked = 0;
    // Asked before the table and before each statement: the third time is
    // after the first statement went out.
    const stopping = (): boolean => {
      asked += 1;
      return asked >= 3;
    };

    const pass = await removeExpiredRows(
      connection.database,
      NOW,
      { batchRows: 2, batchesPerRun: 20 },
      [
        { table: 'browser_proofs', column: 'expires_at', keepForMs: 0 },
        { table: 'sessions', column: 'expires_at', keepForMs: 0 },
      ],
      stopping,
    );

    expect({ pass, left: (await proofsLeft()).length }).toEqual({
      pass: { removed: { browser_proofs: 2 }, failed: [] },
      left: 3,
    });
  });

  it('runs on its schedule by the application clock and stops with its module', async () => {
    const clock = new FrozenClock(at(-ONE_HOUR_MS));
    const timers = new HandTimers();
    const job = new PostgresRetentionJob(connection.database, clock, timers);
    await storeProof('first', at(-1));
    job.onApplicationBootstrap();

    timers.tick();
    await job.runOnce();
    const beforeItExpired = await proofsLeft();
    clock.set(NOW);
    timers.tick();
    await job.runOnce();
    const afterItExpired = await proofsLeft();
    await storeProof('second', at(-1));
    await job.onModuleDestroy();
    timers.tick();
    await job.runOnce();

    expect({
      intervals: timers.intervals,
      beforeItExpired,
      afterItExpired,
      afterStop: await proofsLeft(),
    }).toEqual({
      intervals: [300_000],
      beforeItExpired: ['first'],
      afterItExpired: [],
      afterStop: ['second'],
    });
  });
});
