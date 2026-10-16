import { ColumnType, Kysely } from 'kysely';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';

type NullableText = ColumnType<
  string | null,
  string | null | undefined,
  string | null
>;

/** The columns `0026_passkey_relying_party.sql` adds to the passkey tables. */
// A type alias, not an interface: `withTables` needs an index-compatible type.
export type PasskeyRelyingPartyColumns = {
  passkeys: {
    /** Null on a passkey stored before 0026: it belongs to the web one. */
    rp_id: NullableText;
  };
  passkey_challenges: {
    /** The session a challenge was issued to, when only it may spend it. */
    session_id: NullableText;
  };
};

/** The shared tables, with the passkey tables as 0026 leaves them. */
export function withPasskeyColumns(database: Kysely<PostgresTables>) {
  return database.withTables<PasskeyRelyingPartyColumns>();
}

export type PasskeyDatabase = ReturnType<typeof withPasskeyColumns>;

export type PasskeyTables =
  PasskeyDatabase extends Kysely<infer Tables> ? Tables : never;
