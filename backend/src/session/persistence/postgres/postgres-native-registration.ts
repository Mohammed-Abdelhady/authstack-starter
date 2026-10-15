import { sql } from 'kysely';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RetryableAbortError } from '../../../common/persistence/persistence-errors';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import type { NativeRegistration } from '../../applications/application-registry.store';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../constants/client-ids';
import { postgresApplicationPolicyFields } from './postgres-application-policy-fields';

export async function storePostgresNativeRegistration(
  unitOfWork: UnitOfWork,
  registration: NativeRegistration,
): Promise<void> {
  const { accountAudience, ...policy } = registration;
  const configured = {
    ...postgresApplicationPolicyFields(policy),
    ...(accountAudience === undefined
      ? {}
      : { account_audience: accountAudience }),
    display_name: registration.displayName,
    enabled: true,
    redirect_uris: registration.redirectUris,
    allowed_origins: [],
    audiences: registration.audiences,
    allowed_scopes: registration.allowedScopes,
    absolute_lifetime_ms: registration.policy.absoluteLifetimeMs,
    idle_lifetime_ms: registration.policy.idleLifetimeMs,
    unbound_absolute_lifetime_ms:
      registration.policy.unboundAbsoluteLifetimeMs ?? null,
    unbound_idle_lifetime_ms: registration.policy.unboundIdleLifetimeMs ?? null,
  };
  const advance = registration.endsSessions ? 1 : 0;
  const stored = await postgresTransactionOf(unitOfWork)
    .insertInto('applications')
    .values({
      client_id: registration.clientId,
      environment: registration.environment,
      platform: APPLICATION_PLATFORM.NATIVE,
      client_type: APPLICATION_CLIENT_TYPE.PUBLIC,
      ...configured,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['client_id', 'environment'])
        .doUpdateSet((column) => ({
          ...configured,
          session_version: column('applications.session_version', '+', advance),
          updated_at: sql<Date>`now()`,
        }))
        .where('applications.platform', '=', APPLICATION_PLATFORM.NATIVE)
        .where('applications.client_type', '=', APPLICATION_CLIENT_TYPE.PUBLIC),
    )
    .returning('client_id')
    .execute();
  if (stored.length !== 1) {
    throw new RetryableAbortError();
  }
}
