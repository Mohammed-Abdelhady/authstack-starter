import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { chosenStorage, STORAGE_KIND } from '../storage-choice'; // feature:database-choice
import {
  openPostgresPool,
  postgresMigrationPoolConfig,
} from './postgres-connection';
import {
  MIGRATE_COMMAND,
  MIGRATE_EXIT,
  migrateCommandOf,
  runMigrateCommand,
} from './postgres-migrate';

/**
 * The operator command for PostgreSQL migrations.
 *
 *   pnpm --filter backend run migration:postgres:up
 *   pnpm --filter backend run migration:postgres:status
 *   pnpm --filter backend run migration:postgres:adopt-host <name...>
 *
 * It reads the same environment the server does. The server only verifies the
 * migration record when it starts and never applies a migration itself.
 */
async function main(): Promise<number> {
  const command = migrateCommandOf(process.argv[2]);
  const names = process.argv.slice(3);
  if (
    !command ||
    (command === MIGRATE_COMMAND.ADOPT_HOST && names.length === 0)
  ) {
    console.error('Usage: postgres-migrate <up|status|adopt-host <name...>>');
    return MIGRATE_EXIT.USAGE;
  }
  // Usage errors must be answered before environment validation runs.
  const { APP_CONFIGURATION } =
    await import('../../../config/app-configuration');
  @Module({ imports: [APP_CONFIGURATION] })
  class MigrateModule {}

  const context = await NestFactory.createApplicationContext(MigrateModule, {
    logger: ['error', 'warn'],
  });
  try {
    // feature:database-choice:start
    if (chosenStorage() !== STORAGE_KIND.POSTGRES) {
      console.error(
        'DATABASE_TYPE is not postgres. MongoDB migrations run with migration:up.',
      );
      return MIGRATE_EXIT.USAGE;
    }
    // feature:database-choice:end
    const pool = openPostgresPool(
      postgresMigrationPoolConfig(context.get(ConfigService)),
    );
    try {
      return await runMigrateCommand(
        command,
        pool,
        (line) => console.log(line),
        undefined,
        { names },
      );
    } finally {
      await pool.end();
    }
  } finally {
    await context.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
