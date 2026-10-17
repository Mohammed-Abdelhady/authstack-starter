import { sql, type Transaction } from 'kysely';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import type { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import type { ActivityDetails } from '../../../../session/events/types/activity-event';
import type { PasskeyRelyingPartyColumns } from '../../../../auth/passkeys/persistence/postgres/postgres-passkey.tables'; // feature:passkeys
import { AccountEraser } from '../../stores/account-eraser';
import type { AccountErasureRead, ErasureFacts } from '../../types/erasure';
import {
  addressesToMatch,
  PERSONAL_DETAIL_FIELDS,
} from '../../utils/erasure-matches';

type Writer = Transaction<PostgresTables>;

/**
 * Removes an account and what points at it in one transaction. Session ids
 * and addresses come from `readFactsIn`, read before anything is deleted.
 */
export class PostgresAccountEraser extends AccountEraser {
  async readFactsIn(
    unitOfWork: UnitOfWork,
    userId: string,
    now: Date,
  ): Promise<AccountErasureRead | null> {
    const transaction = postgresTransactionOf(unitOfWork);
    const id = toUuid(userId);
    // A row a restore changed while this waited for it is checked again here.
    const account = await transaction
      .selectFrom('users')
      .select(['id', 'email', 'pending_email'])
      .where('id', '=', id)
      .where('is_deleted', '=', true)
      .where('erase_after', '<=', now)
      .forUpdate()
      .executeTakeFirst();
    if (!account) return null;
    const sessions = await transaction
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', id)
      .execute();
    const identities = await transaction
      .selectFrom('user_linked_accounts')
      .select(['provider', 'provider_id'])
      .where('user_id', '=', id)
      .execute();
    return {
      accountId: id,
      onAccount: {
        address: account.email,
        pendingAddress: account.pending_email,
      },
      sessionIds: sessions.map((session) => session.id),
      identities: identities.map((row) => ({
        provider: row.provider,
        providerId: row.provider_id,
      })),
    };
  }

  async eraseIn(unitOfWork: UnitOfWork, facts: ErasureFacts): Promise<void> {
    const transaction = postgresTransactionOf(unitOfWork);
    await removeSessionsOf(transaction, facts);
    await removeSignInRowsOf(transaction, facts.accountId);
    await removeAddressRowsOf(transaction, facts);
    await blankLogOf(transaction, facts.accountId);
    await transaction
      .deleteFrom('users')
      .where('id', '=', facts.accountId)
      .execute();
  }
}

async function removeSessionsOf(
  transaction: Writer,
  facts: ErasureFacts,
): Promise<void> {
  if (facts.sessionIds.length > 0) {
    await transaction
      .deleteFrom('native_credentials')
      .where('session_id', 'in', facts.sessionIds)
      .execute();
  }
  await transaction
    .deleteFrom('sessions')
    .where('user_id', '=', facts.accountId)
    .execute();
  await transaction
    .deleteFrom('authorization_transactions')
    .where('user_id', '=', facts.accountId)
    .execute();
  await transaction
    .deleteFrom('user_application_grants')
    .where('user_id', '=', facts.accountId)
    .execute();
  // feature:passkeys:start
  await transaction
    .withTables<PasskeyRelyingPartyColumns>()
    .deleteFrom('passkey_challenges')
    .where((eb) =>
      facts.sessionIds.length > 0
        ? eb.or([
            eb('user_id', '=', facts.accountId),
            eb('session_id', 'in', facts.sessionIds),
          ])
        : eb('user_id', '=', facts.accountId),
    )
    .execute();
  // feature:passkeys:end
}

/** Every way the account signed in. Two-factor rows go with the account. */
async function removeSignInRowsOf(
  transaction: Writer,
  accountId: string,
): Promise<void> {
  await transaction
    .deleteFrom('user_linked_accounts')
    .where('user_id', '=', accountId)
    .execute();
  // feature:passkeys:start
  await transaction
    .deleteFrom('passkeys')
    .where('user_id', '=', accountId)
    .execute();
  // feature:passkeys:end
  // feature:totp:start
  await transaction
    .deleteFrom('two_factor_challenges')
    .where('user_id', '=', accountId)
    .execute();
  // feature:totp:end
  // feature:oauth-core:start
  await transaction
    .deleteFrom('provider_link_tickets')
    .where('user_id', '=', accountId)
    .execute();
  // feature:oauth-core:end
}

/**
 * Rows keyed by an address the account held, so none of them can match a
 * later account that registers the same address.
 */
async function removeAddressRowsOf(
  transaction: Writer,
  facts: ErasureFacts,
): Promise<void> {
  const addresses = addressesToMatch(facts.addresses);
  await transaction
    .deleteFrom('native_attempts')
    .where(
      sql<boolean>`(details -> 'verifiedAccount' ->> 'userId') = ${facts.accountId}
        OR (details -> 'email' ->> 'address') = ANY(${addresses}::text[])`,
    )
    .execute();
  await transaction
    .deleteFrom('address_claims')
    .where('owner', '=', facts.accountId)
    .execute();
  await transaction
    .deleteFrom('pending_registrations')
    .where((eb) =>
      addresses.length > 0
        ? eb.or([
            eb('user_id', '=', facts.accountId),
            eb('email', 'in', addresses),
          ])
        : eb('user_id', '=', facts.accountId),
    )
    .execute();
  if (addresses.length === 0) return;
  await transaction
    .deleteFrom('pending_password_resets')
    .where('email', 'in', addresses)
    .execute();
  await transaction
    .deleteFrom('mail_counters')
    .where('email', 'in', addresses)
    .execute();
  // feature:magic-link:start
  await transaction
    .deleteFrom('pending_magic_links')
    .where('email', 'in', addresses)
    .execute();
  // feature:magic-link:end
  // feature:email-code:start
  await transaction
    .deleteFrom('email_codes')
    .where('email', 'in', addresses)
    .execute();
  // feature:email-code:end
}

/** The log keeps its rows; the erased id stays as actor or target only. */
async function blankLogOf(
  transaction: Writer,
  accountId: string,
): Promise<void> {
  const fields = [...PERSONAL_DETAIL_FIELDS];
  await transaction
    .updateTable('security_events')
    .set({
      details: sql<ActivityDetails>`details - ${fields}::text[]`,
    })
    .where((eb) =>
      eb.or([
        eb('target_user_id', '=', accountId),
        eb('actor_id', '=', accountId),
      ]),
    )
    .where(sql<boolean>`details ?| ${fields}::text[]`)
    .execute();
}
