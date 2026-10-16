import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
  PostgresTestServer,
  startPostgresTestServer,
} from '../../../../../test/postgres/server/postgres-test-server';
import { ignoreSessionEnd } from '../../../../../test/postgres/postgres-connection';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { commitCheckedPool } from '../../../../common/persistence/postgres/postgres-commit-tag';
import {
  openPostgresDatabase,
  PostgresTables,
} from '../../../../common/persistence/postgres/postgres-database';
import { applyPostgresMigrations } from '../../../../common/persistence/postgres/postgres-migrations';
import { PostgresUnitOfWorkRunner } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { PostgresSignInMethodStore } from '../../../../user/persistence/postgres/postgres-sign-in-method.store';
import { SignInMethodRule } from '../../../../user/services/sign-in-method.rule';
import { AuthFeaturesService } from '../../../services/features/auth-features.service';
import { PasskeyManagementService } from '../../services/passkey-management.service';
import { PasskeyConfigService } from '../../services/passkey-config.service';
import { PostgresPasskeyStore } from './postgres-passkey.store';

/** `POSTGRES_POOL_MAX=1`, the smallest pool the settings accept. */
const ONE_CONNECTION = 1;
/**
 * How long a statement may wait for a free connection here. The unit of work
 * holds the only one, so a statement sent outside it can never get one: it is
 * still waiting when this runs out, and the removal fails.
 */
const FREE_CONNECTION_WAIT_MS = 500;

describe('passkey removal on a PostgreSQL pool of one connection', () => {
  let server: PostgresTestServer | undefined;
  let pool: Pool | undefined;
  let database: Kysely<PostgresTables>;

  beforeAll(async () => {
    server = await startPostgresTestServer();
    pool = new Pool({
      ...server.connection,
      max: ONE_CONNECTION,
      connectionTimeoutMillis: FREE_CONNECTION_WAIT_MS,
    });
    await applyPostgresMigrations(pool);
    database = openPostgresDatabase(
      pool,
      new PostgresDialect({ pool: commitCheckedPool(pool) }),
    );
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    pool?.on('error', ignoreSessionEnd);
    try {
      await pool?.end();
    } finally {
      await server?.stop();
    }
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  async function seedPasskey(
    userId: string,
    credentialId: string,
  ): Promise<string> {
    const row = await database
      .insertInto('passkeys')
      .values({
        user_id: userId,
        credential_id: credentialId,
        public_key: Buffer.from([7, 7, 7]),
        counter: 0,
        transports: ['internal'],
        device_type: 'singleDevice',
        backed_up: false,
        name: 'Seeded key',
        last_used_at: null,
        created_at: TEST_NOW,
        updated_at: TEST_NOW,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it('removes one of two passkeys without a second connection', async () => {
    const account = await database
      .insertInto('users')
      .values({
        email: 'single@example.test',
        name: 'Contract Tester',
        password_hash: null,
        is_verified: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const removedId = await seedPasskey(account.id, 'Y3JlZGVudGlhbC1vbmU');
    const keptId = await seedPasskey(account.id, 'Y3JlZGVudGlhbC10d28');
    const management = new PasskeyManagementService(
      new PostgresPasskeyStore(database, new FrozenClock(TEST_NOW)),
      new SignInMethodRule(
        new PostgresSignInMethodStore(database),
        new AuthFeaturesService(
          new ConfigService({
            auth: { passwordEnabled: false },
            magicLink: { enabled: false },
          }),
        ),
      ),
      new PostgresUnitOfWorkRunner(database),
      new PasskeyConfigService(
        new ConfigService({ passkeys: { rpId: 'localhost' } }),
      ),
    );

    const answer = await management.remove(account.id, removedId);

    const left = await database.selectFrom('passkeys').select('id').execute();
    expect({ success: answer.success, left }).toEqual({
      success: true,
      left: [{ id: keptId }],
    });
  });
});
