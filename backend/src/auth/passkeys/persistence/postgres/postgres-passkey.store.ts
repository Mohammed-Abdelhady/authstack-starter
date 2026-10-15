import { ExpressionBuilder, Kysely } from 'kysely';
export {
  PostgresPasskeyAccounts,
  PostgresPasskeySignIn,
} from './postgres-passkey-accounts';
import {
  COUNTER_OUTCOME,
  CounterOutcome,
  NewPasskey,
  PASSKEY_CONSTRAINT,
  PasskeyDescriptor,
  PasskeyStore,
  RelyingPartyScope,
  StoredPasskey,
} from '../../stores/passkey.store';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { autocommit } from '../../../persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import {
  PasskeyDatabase,
  PasskeyTables,
  withPasskeyColumns,
} from './postgres-passkey.tables';

/** Constraint names of the table to the rules' shared names. */
const PASSKEY_CONSTRAINTS: Readonly<Record<string, string>> = {
  passkey_credential_unique: PASSKEY_CONSTRAINT.CREDENTIAL_ID,
};

const PASSKEY_COLUMNS = [
  'id',
  'user_id',
  'rp_id',
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
  rp_id: string | null;
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
    ...(row.rp_id === null ? {} : { rpId: row.rp_id }),
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

/** Rows of the relying party, and unmarked rows when the scope takes them. */
function inRelyingParty(relyingParty: RelyingPartyScope) {
  return (where: ExpressionBuilder<PasskeyTables, 'passkeys'>) =>
    relyingParty.includesUnmarked
      ? where.or([
          where('rp_id', '=', relyingParty.rpId),
          where('rp_id', 'is', null),
        ])
      : where('rp_id', '=', relyingParty.rpId);
}

/**
 * One row per passkey, under a unique rule on the credential id. The counter
 * moves in one guarded statement: it counts as moved only while the stored
 * counter is the one the passkey was read with.
 */
export class PostgresPasskeyStore extends PasskeyStore {
  private readonly database: PasskeyDatabase;

  constructor(
    database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
    this.database = withPasskeyColumns(database);
  }

  /** On the work's own connection when there is one, else one statement. */
  private on<Result>(
    unitOfWork: UnitOfWork | undefined,
    statement: (database: PasskeyDatabase) => Promise<Result>,
  ): Promise<Result> {
    return unitOfWork
      ? statement(withPasskeyColumns(postgresTransactionOf(unitOfWork)))
      : autocommit(PASSKEY_CONSTRAINTS, () => statement(this.database));
  }

  listDescriptors(
    userId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<PasskeyDescriptor[]> {
    return this.on(unitOfWork, async (database) => {
      const rows = await database
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

  listDescriptorsFor(
    userId: string,
    relyingParty: RelyingPartyScope,
    unitOfWork?: UnitOfWork,
  ): Promise<PasskeyDescriptor[]> {
    return this.on(unitOfWork, async (database) => {
      const rows = await database
        .selectFrom('passkeys')
        .select(['credential_id', 'transports'])
        .where('user_id', '=', toUuid(userId))
        .where(inRelyingParty(relyingParty))
        .execute();
      return rows.map((row) => ({
        credentialId: row.credential_id,
        transports: row.transports,
      }));
    });
  }

  countForRelyingParty(
    userId: string,
    relyingParty: RelyingPartyScope,
    unitOfWork?: UnitOfWork,
  ): Promise<number> {
    return this.on(unitOfWork, async (database) => {
      const row = await database
        .selectFrom('passkeys')
        .select((select) => select.fn.countAll<string>().as('rows'))
        .where('user_id', '=', toUuid(userId))
        .where(inRelyingParty(relyingParty))
        .executeTakeFirstOrThrow();
      return Number.parseInt(row.rows, 10);
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

  insert(passkey: NewPasskey, unitOfWork?: UnitOfWork): Promise<StoredPasskey> {
    return this.on(unitOfWork, async (database) => {
      const at = this.clock.now();
      const row = await database
        .insertInto('passkeys')
        .values({
          user_id: toUuid(passkey.userId),
          rp_id: passkey.rpId,
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

  findByCredentialId(
    credentialId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<StoredPasskey | null> {
    return this.on(unitOfWork, async (database) => {
      const row = await database
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
    unitOfWork?: UnitOfWork,
  ): Promise<CounterOutcome> {
    return this.on(unitOfWork, async (database) => {
      const moved = await database
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

  markUsed(
    passkey: StoredPasskey,
    usedAt: Date,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    return this.on(unitOfWork, async (database) => {
      await database
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

  findOwned(
    userId: string,
    passkeyId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<StoredPasskey | null> {
    // The unit of work holds a connection. A read on the pool would wait for
    // a second one, and never get it from a pool the transactions filled.
    return this.on(unitOfWork, async (reader) => {
      const row = await reader
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
    await withPasskeyColumns(postgresTransactionOf(unitOfWork))
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
