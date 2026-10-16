import type { Kysely } from 'kysely';
import type { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { autocommit } from '../../../auth/persistence/postgres/postgres-pending-codes-database';
import { APPLICATION_PLATFORM } from '../../constants/client-ids';

export async function readPostgresNativeRequiredPasskey(
  database: Kysely<PostgresTables>,
  environment: string,
): Promise<string | null> {
  const application = await autocommit({}, () =>
    database
      .selectFrom('applications')
      .select('client_id')
      .where('environment', '=', environment)
      .where('platform', '=', APPLICATION_PLATFORM.NATIVE)
      .where('require_passkey', '=', true)
      .limit(1)
      .executeTakeFirst(),
  );
  return application?.client_id ?? null;
}
