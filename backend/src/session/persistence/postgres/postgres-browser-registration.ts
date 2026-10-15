import { sql } from 'kysely';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RetryableAbortError } from '../../../common/persistence/persistence-errors';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import type { BrowserRegistration } from '../../applications/types/browser-registration';
import { postgresApplicationPolicyFields } from './postgres-application-policy-fields';

export async function storePostgresBrowserRegistration(
  work: UnitOfWork,
  registration: BrowserRegistration,
): Promise<void> {
  const { accountAudience, ...policy } = registration;
  const fields = {
    ...postgresApplicationPolicyFields(policy),
    account_audience: accountAudience,
    display_name: registration.displayName,
    allowed_origins: registration.allowedOrigins,
    absolute_lifetime_ms: registration.policy.absoluteLifetimeMs,
    idle_lifetime_ms: registration.policy.idleLifetimeMs,
    ...(registration.enabled === undefined
      ? {}
      : { enabled: registration.enabled }),
    updated_at: sql<Date>`now()`,
  };
  const database = postgresTransactionOf(work);
  if (registration.expectedPolicyVersion === null) {
    const inserted = await database
      .insertInto('applications')
      .values({
        client_id: registration.clientId,
        environment: registration.environment,
        platform: registration.platform,
        client_type: registration.clientType,
        audiences: registration.initialAudiences,
        allowed_scopes: registration.initialScopes,
        ...fields,
      })
      .onConflict((conflict) =>
        conflict.columns(['client_id', 'environment']).doNothing(),
      )
      .returning('client_id')
      .executeTakeFirst();
    if (!inserted) throw new RetryableAbortError();
    return;
  }
  const updated = await database
    .updateTable('applications')
    .set(fields)
    .where('client_id', '=', registration.clientId)
    .where('environment', '=', registration.environment)
    .where('platform', '=', registration.platform)
    .where('client_type', '=', registration.clientType)
    .where('policy_version', '=', registration.expectedPolicyVersion)
    .returning('client_id')
    .executeTakeFirst();
  if (!updated) throw new RetryableAbortError();
}
