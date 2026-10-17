import { Kysely, sql } from 'kysely';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  rememberSignInAccount,
  toSignInAccount,
} from '../../../persistence/postgres/postgres-sign-in-accounts';
import { SecondFactorAccount } from '../../stores/second-factor-account';

function readSecondFactorRow(database: Kysely<PostgresTables>, userId: string) {
  return database
    .selectFrom('users')
    .leftJoin('user_two_factor as state', 'state.user_id', 'users.id')
    .select((select) => [
      'users.id',
      'users.email',
      'users.name',
      'users.role',
      'users.audience',
      'users.permissions',
      'users.auth_provider',
      'users.is_verified',
      'users.is_deleted',
      'users.password_hash',
      'state.enabled',
      'state.secret_ciphertext',
      'state.secret_iv',
      'state.secret_tag',
      'state.confirmed_at',
      'state.last_used_step',
      'state.failed_attempts',
      'state.locked_until',
      select.fn
        .coalesce(
          select
            .selectFrom(
              select
                .selectFrom('user_recovery_codes as code')
                .select(['code.hash', 'code.used_at'])
                .whereRef('code.user_id', '=', 'users.id')
                .orderBy('code.id')
                .as('recovery'),
            )
            .select(({ fn }) => fn.jsonAgg('recovery').as('items')),
          sql<[]>`'[]'::json`,
        )
        .as('recovery_codes'),
    ])
    .where('users.id', '=', toUuid(userId))
    .executeTakeFirst();
}

export async function readPostgresSecondFactorAccount(
  database: Kysely<PostgresTables>,
  userId: string,
  withPassword: boolean,
): Promise<SecondFactorAccount | null> {
  const row = await readSecondFactorRow(database, userId);
  if (!row) return null;

  const secret =
    row.secret_ciphertext !== null &&
    row.secret_iv !== null &&
    row.secret_tag !== null
      ? {
          ciphertext: row.secret_ciphertext,
          iv: row.secret_iv,
          tag: row.secret_tag,
        }
      : null;
  const account: SecondFactorAccount = {
    id: row.id,
    email: row.email ?? '',
    isDeleted: row.is_deleted,
    passwordHash: withPassword ? (row.password_hash ?? undefined) : undefined,
    twoFactor: {
      enabled: row.enabled === true,
      secret,
      confirmedAt: row.confirmed_at,
      // A date inside JSON arrives as text.
      recoveryCodes: row.recovery_codes.map((code) => ({
        hash: code.hash,
        usedAt: code.used_at === null ? null : new Date(code.used_at),
      })),
      lastUsedStep: row.last_used_step,
      failedAttempts: row.failed_attempts ?? 0,
      lockedUntil: row.locked_until,
    },
  };
  return rememberSignInAccount(
    account,
    toSignInAccount(row, row.enabled === true),
  );
}
