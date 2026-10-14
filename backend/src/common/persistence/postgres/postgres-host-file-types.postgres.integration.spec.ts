import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATE_CASE_TIMEOUT_MS } from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  useHostMigrations,
} from './postgres-host-migrate.harness-spec';

const FILE_TYPES = [
  { id: 'host', kind: 'directory' },
  { id: 'host', kind: 'dangling symlink' },
  { id: 'host', kind: 'external symlink' },
  { id: 'core', kind: 'directory' },
  { id: 'core', kind: 'dangling symlink' },
  { id: 'core', kind: 'external symlink' },
];

describe('migration discovery accepts regular files only', () => {
  const { emptyDatabase, sources, command, startup } = useHostMigrations();

  it.each(FILE_TYPES)(
    '$id source refuses a $kind before SQL at every entry point',
    async ({ id, kind }) => {
      const pool = await emptyDatabase();
      const invalid = sources();
      const entry = join(invalid.host.directory, HOST_FILE);
      if (kind === 'directory') {
        mkdirSync(entry);
      } else if (kind === 'dangling symlink') {
        symlinkSync(join(invalid.host.directory, 'missing.sql'), entry);
      } else {
        const outside = sources({
          'outside.sql': 'CREATE TABLE escaped_migration (id integer)',
        });
        symlinkSync(join(outside.host.directory, 'outside.sql'), entry);
      }
      const source =
        id === 'host'
          ? invalid
          : {
              core: { ...invalid.core, directory: invalid.host.directory },
              host: sources().host,
            };
      const message = `The ${id} migration entry 0042_orders.sql is not a regular file. Migrations must be regular files.`;
      expect(await command('up', pool, source)).toEqual({
        exit: 1,
        said: [message],
      });
      expect(await command('status', pool, source)).toEqual({
        exit: 1,
        said: [message],
      });
      expect(await startup(pool, source)).toEqual({
        name: 'MigrationEntryError',
        message,
      });
      expect(await command('adopt-host', pool, source, [HOST_FILE])).toEqual({
        exit: 1,
        said: [message],
      });
      const tables = await pool.query<{
        core: string | null;
        host: string | null;
        escaped: string | null;
      }>(
        "SELECT to_regclass('schema_migrations')::text AS core, to_regclass('host_migrations')::text AS host, to_regclass('escaped_migration')::text AS escaped",
      );
      expect(tables.rows).toEqual([{ core: null, host: null, escaped: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
