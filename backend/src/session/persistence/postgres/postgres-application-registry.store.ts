import { storePostgresNativeRegistration } from './postgres-native-registration';
import { readPostgresRequiredPasskeyApplication } from './postgres-required-passkey-application';
import { hasPostgresAccountAudience } from './postgres-application-audience';
import { storePostgresBrowserRegistration } from './postgres-browser-registration';
import type { BrowserRegistration } from '../../applications/types/browser-registration';
import { Kysely, sql } from 'kysely';
import { postgresApplicationPolicyFields } from './postgres-application-policy-fields';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  ApplicationRegistryStore,
  FirstPartyKey,
  FirstPartyRegistration,
  NativeRegistration,
  RegisteredApplication,
  RegisteredClient,
  StoredRegistration,
} from '../../applications/application-registry.store';
import { APPLICATION_PLATFORM } from '../../constants/client-ids';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import {
  APPLICATION_COLUMNS,
  ApplicationRow,
  toIssuanceApplication,
} from './postgres-issuance-mappers';
import { autocommit } from '../../../auth/persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

const REGISTERED_COLUMNS = [...APPLICATION_COLUMNS, 'allowed_origins'] as const;

function toRegisteredApplication(
  row: ApplicationRow & { allowed_origins: string[] },
): RegisteredApplication {
  return {
    ...toIssuanceApplication(row),
    allowedOrigins: row.allowed_origins,
  };
}

const CLIENT_COLUMNS = [
  ...REGISTERED_COLUMNS,
  'client_type',
  'redirect_uris',
  'display_name',
] as const;

function toRegisteredClient(
  row: ApplicationRow & {
    allowed_origins: string[];
    client_type: string;
    redirect_uris: string[];
    display_name: string;
  },
): RegisteredClient {
  return {
    ...toRegisteredApplication(row),
    clientType: row.client_type,
    redirectUris: row.redirect_uris,
    displayName: row.display_name,
  };
}

/**
 * A committed authority read is one statement sent to the primary by itself.
 *
 * A reconciliation takes the registry at `takeRegistrations` with a table lock
 * that lets readers through and keeps every other writer of applications out.
 * A second reconciliation is refused there at once (`NOWAIT`), which the runner
 * reports as a retryable abort. Reading before that lock would let two
 * reconciliations both decide to advance one version.
 */
export class PostgresApplicationRegistryStore extends ApplicationRegistryStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  findRequiredPasskeyApplication = (environment: string) =>
    readPostgresRequiredPasskeyApplication(this.database, environment);

  hasAccountAudience(
    unitOfWork: UnitOfWork,
    environment: string,
  ): Promise<boolean> {
    return hasPostgresAccountAudience(unitOfWork, environment);
  }

  async readCommittedApplication(
    environment: string,
    clientId: string,
  ): Promise<RegisteredApplication | null> {
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('applications')
        .select(REGISTERED_COLUMNS)
        .where('client_id', '=', clientId)
        .where('environment', '=', environment)
        .executeTakeFirst(),
    );
    return row ? toRegisteredApplication(row) : null;
  }

  async readCommittedApplications(
    environment: string,
    clientIds: string[],
  ): Promise<RegisteredApplication[]> {
    const rows = await autocommit({}, () =>
      this.database
        .selectFrom('applications')
        .select(REGISTERED_COLUMNS)
        .where('client_id', '=', sql<string>`ANY(${clientIds})`)
        .where('environment', '=', environment)
        .execute(),
    );
    return rows.map(toRegisteredApplication);
  }

  async findApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<RegisteredApplication | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('applications')
      .select(REGISTERED_COLUMNS)
      .where('client_id', '=', clientId)
      .where('environment', '=', environment)
      .executeTakeFirst();
    return row ? toRegisteredApplication(row) : null;
  }

  async findApplications(
    unitOfWork: UnitOfWork,
    environment: string,
    clientIds: string[],
  ): Promise<RegisteredApplication[]> {
    const rows = await postgresTransactionOf(unitOfWork)
      .selectFrom('applications')
      .select(REGISTERED_COLUMNS)
      .where('client_id', '=', sql<string>`ANY(${clientIds})`)
      .where('environment', '=', environment)
      .execute();
    return rows.map(toRegisteredApplication);
  }

  async lookUpClient(
    environment: string,
    clientId: string,
  ): Promise<RegisteredClient | null> {
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('applications')
        .select(CLIENT_COLUMNS)
        .where('client_id', '=', clientId)
        .where('environment', '=', environment)
        .executeTakeFirst(),
    );
    return row ? toRegisteredClient(row) : null;
  }

  async findClient(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<RegisteredClient | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('applications')
      .select(CLIENT_COLUMNS)
      .where('client_id', '=', clientId)
      .where('environment', '=', environment)
      .executeTakeFirst();
    return row ? toRegisteredClient(row) : null;
  }

  async registerFirstParty(
    registration: FirstPartyRegistration,
  ): Promise<void> {
    const configured = {
      ...postgresApplicationPolicyFields(registration),
      display_name: registration.displayName,
      platform: registration.platform,
      client_type: registration.clientType,
      allowed_origins: registration.allowedOrigins,
      absolute_lifetime_ms: registration.policy.absoluteLifetimeMs,
      idle_lifetime_ms: registration.policy.idleLifetimeMs,
    };
    await autocommit({}, () =>
      this.database
        .insertInto('applications')
        .values({
          client_id: registration.clientId,
          environment: registration.environment,
          audiences: registration.initialAudiences,
          allowed_scopes: registration.initialScopes,
          ...configured,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['client_id', 'environment'])
            .doUpdateSet({ ...configured, updated_at: sql<Date>`now()` }),
        )
        .execute(),
    );
  }

  async allowOrigin(
    environment: string,
    applications: FirstPartyKey[],
    origin: string,
  ): Promise<void> {
    if (applications.length === 0) {
      return;
    }
    await autocommit({}, () =>
      this.database
        .updateTable('applications')
        .set({
          allowed_origins: sql<
            string[]
          >`array_append(allowed_origins, ${origin})`,
          updated_at: sql<Date>`now()`,
        })
        .where('environment', '=', environment)
        .where((application) =>
          application.or(
            applications.map(({ clientId, platform }) =>
              application.and([
                application('client_id', '=', clientId),
                application('platform', '=', platform),
              ]),
            ),
          ),
        )
        .where(sql<boolean>`NOT (${origin} = ANY(allowed_origins))`)
        .execute(),
    );
  }

  async takeRegistrations(
    unitOfWork: UnitOfWork,
    environment: string,
    clientIds: string[],
  ): Promise<StoredRegistration[]> {
    const transaction = postgresTransactionOf(unitOfWork);
    await sql`LOCK TABLE applications IN SHARE ROW EXCLUSIVE MODE NOWAIT`.execute(
      transaction,
    );
    const rows = await transaction
      .selectFrom('applications')
      .select([...APPLICATION_COLUMNS, 'client_type', 'redirect_uris'])
      .where('client_id', '=', sql<string>`ANY(${clientIds})`)
      .where('environment', '=', environment)
      .execute();
    return rows.map((row) => {
      const policy = toIssuanceApplication(row);
      return {
        clientId: row.client_id,
        platform: row.platform,
        clientType: row.client_type,
        enabled: row.enabled,
        redirectUris: row.redirect_uris,
        signUp: policy.signUp,
        requirePasskey: policy.requirePasskey,
        signInMethods: policy.signInMethods,
        accountAudience: policy.accountAudience,
        policyVersion: policy.policyVersion,
        sessionCap: policy.sessionCap,
        policy: policy.policy,
      };
    });
  }

  storeBrowserRegistration(
    unitOfWork: UnitOfWork,
    registration: BrowserRegistration,
  ): Promise<void> {
    return storePostgresBrowserRegistration(unitOfWork, registration);
  }

  storeNativeRegistration(
    unitOfWork: UnitOfWork,
    registration: NativeRegistration,
  ): Promise<void> {
    return storePostgresNativeRegistration(unitOfWork, registration);
  }

  async disableNativeApplicationsExcept(
    unitOfWork: UnitOfWork,
    environment: string,
    keptClientIds: string[],
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('applications')
      .set((column) => ({
        enabled: false,
        session_version: column('session_version', '+', 1),
        updated_at: sql<Date>`now()`,
      }))
      .where('environment', '=', environment)
      .where('platform', '=', APPLICATION_PLATFORM.NATIVE)
      .where('enabled', '=', true)
      .where(sql<boolean>`NOT (client_id = ANY(${keptClientIds}))`)
      .execute();
  }
}
