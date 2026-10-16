import {
  PENDING_PURPOSE,
  MAIL_COUNTER_PURPOSE,
} from '../../../../auth/constants/registration';
import { randomUUID } from 'node:crypto';
import { openTestConnection } from '../../../../../test/postgres/postgres-connection';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { PostgresUnitOfWorkRunner } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { PostgresAccountDeletionStore } from './postgres-account-deletion.store';
import { PostgresAccountEraser } from './postgres-account-eraser';
import { PostgresErasureJobStore } from './postgres-erasure-job.store';
import type {
  ErasureAccount,
  ErasureHarness,
} from '../../erasure.contract.harness-spec';

export async function bootPostgresErasureHarness(): Promise<ErasureHarness> {
  const c = await openTestConnection();
  const clock = new FrozenClock(TEST_NOW);
  const tracked = new Map<
    string,
    Map<string, { table: string; ids: string[] }>
  >();
  async function insert(
    table: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    const keys = Object.keys(values);
    const result = await c.pool.query<{ id: string }>(
      `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(values),
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`No inserted id for ${table}`);
    return String(id);
  }
  async function seedChildren(a: ErasureAccount): Promise<void> {
    const rows = new Map<string, { table: string; ids: string[] }>();
    tracked.set(a.id, rows);
    const add = async (
      label: string,
      table: string,
      values: Record<string, unknown>,
    ) => {
      const id = await insert(table, values);
      const trackedRows = rows.get(label) ?? { table, ids: [] };
      trackedRows.ids.push(id);
      rows.set(label, trackedRows);
      return id;
    };
    rows.set('users', { table: 'users', ids: [a.id] });
    const expiry = new Date('2099-01-02T12:00:00.000Z');
    const session = await add('sessions', 'sessions', {
      user_id: a.id,
      token_hash: Buffer.from(a.id),
      user_agent: 'contract',
      ip: '127.0.0.1',
      client_id: 'contract',
      user_version: 0,
      client_version: 0,
      grant_version: 0,
      auth_epoch: 1,
      schema_version: 1,
      scopes: [],
      audience: 'api',
      authentication_methods: ['password'],
      credential_purpose: 'browser',
      browser_generation: 0,
      authenticated_at: TEST_NOW,
      last_used_at: TEST_NOW,
      last_activity_at: TEST_NOW,
      expires_at: expiry,
      idle_expires_at: expiry,
    });
    await add('credentials', 'native_credentials', {
      token_hash: a.id,
      purpose: 'native_refresh',
      session_id: session,
      client_id: 'contract',
      generation: 0,
      family_id: a.id,
      issued_at: TEST_NOW,
      expires_at: expiry,
    });
    await add('authorization', 'authorization_transactions', {
      transaction_id: a.id,
      client_id: 'contract',
      redirect_uri: 'https://example.test/callback',
      code_challenge: 'challenge',
      state: 'state',
      intent: 'sign-in',
      expires_at: expiry,
      user_id: a.id,
      auth_epoch: 1,
    });
    await add('grants', 'user_application_grants', {
      user_id: a.id,
      client_id: 'contract',
    });
    await add('linked', 'user_linked_accounts', {
      user_id: a.id,
      provider: 'google',
      provider_id: a.email,
      linked_at: TEST_NOW,
    });
    // feature:passkeys:start
    await add('passkeys', 'passkeys', {
      user_id: a.id,
      credential_id: a.id,
      public_key: Buffer.from('public'),
      name: 'key',
      created_at: TEST_NOW,
      updated_at: TEST_NOW,
    });
    await add('passkeyChallenges', 'passkey_challenges', {
      user_id: a.id,
      challenge_hash: `${a.id}:user`,
      purpose: 'registration',
      expires_at: expiry,
    });
    await add('passkeyChallenges', 'passkey_challenges', {
      session_id: session,
      challenge_hash: `${a.id}:session`,
      purpose: 'authentication',
      expires_at: expiry,
    });
    // feature:passkeys:end
    // feature:totp:start
    await add('twoFactor', 'two_factor_challenges', {
      user_id: a.id,
      nonce_hash: a.id,
      expires_at: expiry,
    });
    // feature:totp:end
    // feature:oauth-core:start
    await add('tickets', 'provider_link_tickets', {
      ticket_hash: a.id,
      user_id: a.id,
      session_id: session,
      client_id: 'contract',
      provider: 'google',
      nonce_digest: 'nonce',
      expires_at: expiry,
    });
    // feature:oauth-core:end
    const attempt = {
      client_id: 'contract',
      redirect_uri: 'https://example.test/callback',
      code_challenge: 'challenge',
      state: 'state',
      requested_scopes: [],
      flow: 'password',
      phase: 'email',
      auth_epoch: 1,
      created_at: TEST_NOW,
      expires_at: expiry,
      secret_hash: 'a'.repeat(64),
    };
    await add('attempts', 'native_attempts', {
      ...attempt,
      id: randomUUID(),
      attempt_id: `${a.id}:user`,
      details: JSON.stringify({ verifiedAccount: { userId: a.id } }),
    });
    await add('attempts', 'native_attempts', {
      ...attempt,
      id: randomUUID(),
      attempt_id: `${a.id}:address`,
      details: JSON.stringify({
        email: { address: a.pendingEmail.trim().toLowerCase() },
      }),
    });
    await c.pool.query(
      'INSERT INTO address_claims (address,kind,owner,lapses_at) VALUES ($1,$2,$3,$4)',
      [a.pendingEmail.trim().toLowerCase(), 'EMAIL_CHANGE', a.id, expiry],
    );
    rows.set('claims', {
      table: 'address_claims',
      ids: [a.pendingEmail.trim().toLowerCase()],
    });
    await add('registrations', 'pending_registrations', {
      email: `bound-${a.email}`,
      user_id: a.id,
      purpose: PENDING_PURPOSE.EMAIL_CHANGE,
      hashed_code: 'hash',
      expires_at: expiry,
    });
    await add('registrations', 'pending_registrations', {
      email: a.pendingEmail,
      purpose: PENDING_PURPOSE.SIGNUP,
      hashed_code: 'hash',
      expires_at: expiry,
    });
    for (const email of [a.email, a.pendingEmail.trim().toLowerCase()]) {
      await add('resets', 'pending_password_resets', {
        email,
        hashed_code: 'hash',
        expires_at: expiry,
      });
      await add('counters', 'mail_counters', {
        email,
        purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
        window_started_at: TEST_NOW,
        expires_at: expiry,
      });
      // feature:magic-link:start
      await add('magicLinks', 'pending_magic_links', {
        email,
        token_hash: `${a.id}:${email}`,
        expires_at: expiry,
      });
      // feature:magic-link:end
      // feature:email-code:start
      await add('emailCodes', 'email_codes', {
        email,
        owner_id: email,
        purpose: 'sign-in',
        code_hash: 'hash',
        expires_at: expiry,
        purge_after: expiry,
      });
      // feature:email-code:end
    }
    for (const role of ['actor', 'target']) {
      await insert('security_events', {
        event_id: `${a.id}:${role}`,
        actor_id: role === 'actor' ? a.id : 'unrelated',
        target_user_id: role === 'target' ? a.id : 'unrelated',
        action: 'account.updated',
        outcome: 'success',
        occurred_at: TEST_NOW,
        purge_after: expiry,
        details: JSON.stringify({
          name: 'Personal',
          email: a.email,
          changedFields: ['role'],
        }),
      });
    }
  }
  return {
    jobs: new PostgresErasureJobStore(c.database),
    deletion: new PostgresAccountDeletionStore(c.database),
    eraser: new PostgresAccountEraser(),
    runner: new PostgresUnitOfWorkRunner(c.database),
    clock,
    seedAccount: async (email, deleted = false, eraseAfter) => {
      const pendingEmail = ` Pending-${email} `;
      const id = await insert('users', {
        email,
        pending_email: pendingEmail,
        name: 'Contract',
        is_deleted: deleted,
        erase_after: eraseAfter ?? null,
      });
      return { id, email, pendingEmail };
    },
    schedule: async (id) => {
      const result = await c.pool.query<{ erase_after: Date | null }>(
        'SELECT erase_after FROM users WHERE id=$1',
        [id],
      );
      return result.rows[0]?.erase_after ?? null;
    },
    deactivate: async (id, deletedAt) => {
      await c.pool.query(
        'UPDATE users SET is_deleted=true, deleted_at=$2 WHERE id=$1',
        [id, deletedAt],
      );
    },
    seedChildren,
    counts: async (a) => {
      const results: Record<string, number> = {};
      const rows = tracked.get(a.id);
      if (!rows) throw new Error('Account children were not seeded');
      for (const [label, entry] of rows) {
        const field = label === 'claims' ? 'address' : 'id';
        const count = await c.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${entry.table}" WHERE "${field}"::text=ANY($1::text[])`,
          [entry.ids],
        );
        results[label] = Number(count.rows[0]?.count);
      }
      return results;
    },
    events: async () => {
      const rows = await c.pool.query<{
        event_id: string;
        actor_id: string;
        target_user_id: string;
        action: string;
        details: Record<string, unknown>;
      }>(
        'SELECT event_id,actor_id,target_user_id,action,details FROM security_events',
      );
      return rows.rows.map((row) => ({
        eventId: row.event_id,
        actorId: row.actor_id,
        targetUserId: row.target_user_id,
        action: row.action,
        details: row.details,
      }));
    },
    reset: async () => {
      await c.rollBackOpenWork();
      // feature:oauth-core:start
      await c.pool.query(
        'DELETE FROM provider_link_tickets; DELETE FROM provider_revocations; DELETE FROM provider_tokens',
      );
      // feature:oauth-core:end
      await c.pool.query(
        'DELETE FROM account_deletion_receipts; DELETE FROM erasure_jobs',
      );
      await c.reset();
      tracked.clear();
    },
    close: c.close,
    checkSetup: async () => {
      expect(c.appliedMigrations).toContain('0029_account_erasure.sql');
      const rows = await c.pool.query<{ name: string }>(
        "SELECT indexname AS name FROM pg_indexes WHERE tablename IN ('users','erasure_jobs','account_deletion_receipts') UNION SELECT conname AS name FROM pg_constraint WHERE conrelid IN ('erasure_jobs'::regclass,'account_deletion_receipts'::regclass)",
      );
      expect(rows.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'user_erase_due',
          'erasure_job_user_unique',
          'erasure_job_purge_after',
          'erasure_job_open',
          'erasure_job_step',
          'erasure_job_attempts_nonnegative',
          'account_deletion_receipts_pkey',
          'account_deletion_receipt_hash',
          'account_deletion_receipt_purge_after',
        ]),
      );
    },
  };
}
