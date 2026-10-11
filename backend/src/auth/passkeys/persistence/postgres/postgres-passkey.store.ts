import { Response } from 'express';
import { Kysely } from 'kysely';
import {
  COUNTER_OUTCOME,
  CounterOutcome,
  NewPasskey,
  PASSKEY_CONSTRAINT,
  PasskeyDescriptor,
  PasskeyStore,
  StoredPasskey,
} from '../../stores/passkey.store';
import {
  PasskeyAccount,
  PasskeyAccounts,
  PasskeySignIn,
  PasskeySignInOutcome,
  StoredSignInMethods,
} from '../../stores/passkey-accounts';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import {
  rememberSignInAccount,
  SIGN_IN_COLUMNS,
  signInAccountOf,
  toSignInAccount,
} from '../../../persistence/postgres/postgres-sign-in-accounts';
import { secondFactorEnabled } from '../../../../user/persistence/postgres/postgres-account-rows'; // feature:totp
import { FIRST_FACTOR } from '../../../services/sessions/first-factor'; // feature:totp
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { autocommit } from '../../../persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';

/** Constraint names of the table to the rules' shared names. */
const PASSKEY_CONSTRAINTS: Readonly<Record<string, string>> = {
  passkey_credential_unique: PASSKEY_CONSTRAINT.CREDENTIAL_ID,
};

const PASSKEY_COLUMNS = [
  'id',
  'user_id',
  'credential_id',
  'public_key',
  'counter',
  'transports',
  'device_type',
  'backed_up',
  'name',
  'last_used_at',
  'created_at',
] as const;

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
  device_type: string | null;
  backed_up: boolean;
  name: string;
  last_used_at: Date | null;
  created_at: Date;
}

function toStoredPasskey(row: PasskeyRow): StoredPasskey {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: Number.parseInt(row.counter, 10),
    transports: row.transports,
    deviceType: row.device_type ?? undefined,
    backedUp: row.backed_up,
    name: row.name,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

/**
 * One row per passkey, under a unique rule on the credential id. The counter
 * moves in one guarded statement: it counts as moved only while the stored
 * counter is the one the passkey was read with.
 */
export class PostgresPasskeyStore extends PasskeyStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  listDescriptors(userId: string): Promise<PasskeyDescriptor[]> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const rows = await this.database
        .selectFrom('passkeys')
        .select(['credential_id', 'transports'])
        .where('user_id', '=', toUuid(userId))
        .execute();
      return rows.map((row) => ({
        credentialId: row.credential_id,
        transports: row.transports,
      }));
    });
  }

  isCredentialRegistered(credentialId: string): Promise<boolean> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('passkeys')
        .select('id')
        .where('credential_id', '=', credentialId)
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  insert(passkey: NewPasskey): Promise<StoredPasskey> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const at = this.clock.now();
      const row = await this.database
        .insertInto('passkeys')
        .values({
          user_id: toUuid(passkey.userId),
          credential_id: passkey.credentialId,
          public_key: passkey.publicKey,
          counter: passkey.counter,
          transports: passkey.transports,
          device_type: passkey.deviceType ?? null,
          backed_up: passkey.backedUp,
          // The name is stored trimmed.
          name: passkey.name.trim(),
          last_used_at: null,
          created_at: at,
          updated_at: at,
        })
        .returning(PASSKEY_COLUMNS)
        .executeTakeFirstOrThrow();
      return toStoredPasskey(row);
    });
  }

  findByCredentialId(credentialId: string): Promise<StoredPasskey | null> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('passkeys')
        .select(PASSKEY_COLUMNS)
        .where('credential_id', '=', credentialId)
        .executeTakeFirst();
      return row ? toStoredPasskey(row) : null;
    });
  }

  advanceCounter(
    passkey: StoredPasskey,
    use: { counter: number; usedAt: Date },
  ): Promise<CounterOutcome> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const moved = await this.database
        .updateTable('passkeys')
        .set({
          counter: use.counter,
          last_used_at: use.usedAt,
          updated_at: this.clock.now(),
        })
        .where('id', '=', toUuid(passkey.id))
        .where('counter', '=', String(passkey.counter))
        .executeTakeFirst();
      return moved.numUpdatedRows === 1n
        ? COUNTER_OUTCOME.ADVANCED
        : COUNTER_OUTCOME.ALREADY_ADVANCED;
    });
  }

  markUsed(passkey: StoredPasskey, usedAt: Date): Promise<void> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      await this.database
        .updateTable('passkeys')
        .set({ last_used_at: usedAt, updated_at: this.clock.now() })
        .where('id', '=', toUuid(passkey.id))
        .execute();
    });
  }

  listForAccount(userId: string): Promise<StoredPasskey[]> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const rows = await this.database
        .selectFrom('passkeys')
        .select(PASSKEY_COLUMNS)
        .where('user_id', '=', toUuid(userId))
        .orderBy('created_at', 'desc')
        .execute();
      return rows.map(toStoredPasskey);
    });
  }

  findOwned(userId: string, passkeyId: string): Promise<StoredPasskey | null> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('passkeys')
        .select(PASSKEY_COLUMNS)
        .where('id', '=', toUuid(passkeyId))
        .where('user_id', '=', toUuid(userId))
        .executeTakeFirst();
      return row ? toStoredPasskey(row) : null;
    });
  }

  rename(passkey: StoredPasskey, name: string): Promise<StoredPasskey> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .updateTable('passkeys')
        .set({ name: name.trim(), updated_at: this.clock.now() })
        .where('id', '=', toUuid(passkey.id))
        .returning(PASSKEY_COLUMNS)
        .executeTakeFirst();
      if (!row) {
        throw new Error('the passkey vanished while it was renamed');
      }
      return toStoredPasskey(row);
    });
  }

  async remove(unitOfWork: UnitOfWork, passkey: StoredPasskey): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .deleteFrom('passkeys')
      .where('id', '=', toUuid(passkey.id))
      .execute();
  }

  countForAccount(userId: string): Promise<number> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('passkeys')
        .select((select) => select.fn.countAll<string>().as('rows'))
        .where('user_id', '=', toUuid(userId))
        .executeTakeFirstOrThrow();
      return Number.parseInt(row.rows, 10);
    });
  }
}

/** The accounts passkeys belong to, read from the account tables. */
export class PostgresPasskeyAccounts extends PasskeyAccounts {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  findAccount(userId: string): Promise<PasskeyAccount | null> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('users')
        .select([...SIGN_IN_COLUMNS, 'is_deleted'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      const signIn = toSignInAccount(
        row,
        await secondFactorEnabled(this.database, row.id), // feature:totp
      );
      return rememberSignInAccount(
        {
          id: signIn.id,
          email: signIn.email,
          name: signIn.name,
          isDeleted: row.is_deleted,
        },
        signIn,
      );
    });
  }

  findSignInMethods(userId: string): Promise<StoredSignInMethods | null> {
    return autocommit(PASSKEY_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('users')
        .select((select) => [
          'users.password_hash',
          select
            .selectFrom('user_linked_accounts as link')
            .select((link) => link.fn.countAll<string>().as('links'))
            .whereRef('link.user_id', '=', 'users.id')
            .as('links'),
        ])
        .where('users.id', '=', toUuid(userId))
        .executeTakeFirst();
      return row
        ? {
            hasPassword: Boolean(row.password_hash),
            hasLinkedAccount: Number.parseInt(row.links ?? '0', 10) > 0,
          }
        : null;
    });
  }
}

/** Finishes the sign-in with the account the passkey routes read. */
export class PostgresPasskeySignIn extends PasskeySignIn {
  constructor(private readonly completion: SignInCompletion) {
    super();
  }

  issueSession(
    account: PasskeyAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    return this.completion.issueSession(signInAccountOf(account), response);
  }

  completeSignIn(
    account: PasskeyAccount,
    response: Response,
  ): Promise<PasskeySignInOutcome> {
    return this.completion.completeSignIn(
      signInAccountOf(account),
      response,
      FIRST_FACTOR.PASSKEY, // feature:totp
    );
  }
}
