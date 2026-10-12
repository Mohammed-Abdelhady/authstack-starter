import { Kysely, sql } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  AccessGrant,
  APPLICATION_SWITCH,
  ApplicationAccessStore,
  ApplicationSwitch,
  NewBlockedGrant,
} from '../../applications/application-access.store';
import {
  newSecurityEvent,
  RecordSecurityEventInput,
} from '../../events/security-event-recorder';
import { SecurityEventStore } from '../../events/security-event.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from './postgres-issuance-mappers';
import { autocommit } from '../../../auth/persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

const GRANT_COLUMNS = [
  'id',
  'user_id',
  'client_id',
  'allowed',
  'session_version',
] as const;

function toAccessGrant(row: {
  id: string;
  user_id: string;
  client_id: string;
  allowed: boolean;
  session_version: number;
}): AccessGrant {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    allowed: row.allowed,
    sessionVersion: row.session_version,
  };
}

/**
 * Takes the account's grants at `takeGrantForChange` with the row lock sign-in
 * takes on the account, before the grant is read. A second unit of work is
 * refused there at once (`NOWAIT`), which the runner reports as a retryable
 * abort.
 */
export class PostgresApplicationAccessStore extends ApplicationAccessStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
    private readonly events: SecurityEventStore,
  ) {
    super();
  }

  async readGrant(
    userId: string,
    clientId: string,
  ): Promise<AccessGrant | null> {
    const account = toUuid(userId);
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('user_application_grants')
        .select(GRANT_COLUMNS)
        .where('user_id', '=', account)
        .where('client_id', '=', clientId)
        .executeTakeFirst(),
    );
    return row ? toAccessGrant(row) : null;
  }

  async takeGrantForChange(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<AccessGrant | null> {
    const transaction = postgresTransactionOf(unitOfWork);
    const account = toUuid(userId);
    await transaction
      .selectFrom('users')
      .select('id')
      .where('id', '=', account)
      .forNoKeyUpdate()
      .noWait()
      .execute();
    const row = await transaction
      .selectFrom('user_application_grants')
      .select(GRANT_COLUMNS)
      .where('user_id', '=', account)
      .where('client_id', '=', clientId)
      .executeTakeFirst();
    return row ? toAccessGrant(row) : null;
  }

  async createBlockedGrant(
    unitOfWork: UnitOfWork,
    grant: NewBlockedGrant,
  ): Promise<AccessGrant> {
    const row = await postgresTransactionOf(unitOfWork)
      .insertInto('user_application_grants')
      .values({
        user_id: toUuid(grant.userId),
        client_id: grant.clientId,
        allowed: false,
        session_version: grant.sessionVersion,
        issuance_fence: 0,
      })
      .returning(GRANT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAccessGrant(row);
  }

  async blockGrant(unitOfWork: UnitOfWork, grantId: string): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('user_application_grants')
      .set((column) => ({
        allowed: false,
        session_version: column('session_version', '+', 1),
      }))
      .where('id', '=', toUuid(grantId))
      .execute();
  }

  async disableApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<ApplicationSwitch> {
    const switched = await postgresTransactionOf(unitOfWork)
      .updateTable('applications')
      .set((column) => ({
        enabled: false,
        session_version: column('session_version', '+', 1),
        updated_at: sql<Date>`now()`,
      }))
      .where('client_id', '=', clientId)
      .where('environment', '=', environment)
      .returning('client_id')
      .execute();
    return switched.length === 1
      ? APPLICATION_SWITCH.SWITCHED
      : APPLICATION_SWITCH.NOT_REGISTERED;
  }

  async enableApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<ApplicationSwitch> {
    const switched = await postgresTransactionOf(unitOfWork)
      .updateTable('applications')
      .set({ enabled: true, updated_at: sql<Date>`now()` })
      .where('client_id', '=', clientId)
      .where('environment', '=', environment)
      .returning('client_id')
      .execute();
    return switched.length === 1
      ? APPLICATION_SWITCH.SWITCHED
      : APPLICATION_SWITCH.NOT_REGISTERED;
  }

  async appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void> {
    await this.events.append(
      unitOfWork,
      newSecurityEvent(event, this.clock.now()),
    );
  }
}
