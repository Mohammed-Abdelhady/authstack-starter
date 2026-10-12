import { Pool } from 'pg';
import { PostgresActivationAccounts } from '../../../auth/persistence/postgres/postgres-activation-accounts';
import { openPostgresDatabase } from './postgres-database';
import { PostgresIdFormat } from './postgres-id-format';
import { newPostgresId } from './postgres-new-id';

describe('newPostgresId', () => {
  // 0x0123456789ab milliseconds after the epoch.
  const AT = new Date(1_250_999_896_491);

  it('makes a UUID version 7 that carries the time it was given', () => {
    const id = newPostgresId(AT);
    const [time, timeLow, version, variant] = id.split('-');

    expect({
      time: `${time}${timeLow}`,
      version: version[0],
      variant: ['8', '9', 'a', 'b'].includes(variant[0]),
      length: id.length,
    }).toEqual({
      time: '0123456789ab',
      version: '7',
      variant: true,
      length: 36,
    });
  });

  it('is an id the PostgreSQL adapter reads, and not twenty-four hexadecimal digits', () => {
    const id = newPostgresId(AT);

    expect({
      postgres: new PostgresIdFormat().isId(id),
      twentyFourHexDigits: /^[0-9a-f]{24}$/.test(id),
    }).toEqual({ postgres: true, twentyFourHexDigits: false });
  });

  it('gives a new account an id of that form, at the application clock', async () => {
    const pool = new Pool({
      connectionString: 'postgres://unused.invalid/none',
    });
    const accounts = new PostgresActivationAccounts(
      openPostgresDatabase(pool),
      { now: () => AT },
    );

    const id = accounts.newAccountId();
    await pool.end();

    expect({ time: id.slice(0, 13), version: id[14] }).toEqual({
      time: '01234567-89ab',
      version: '7',
    });
  });

  it('never makes the same id twice in one millisecond', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newPostgresId(AT)));

    expect(ids.size).toBe(2000);
  });
});
