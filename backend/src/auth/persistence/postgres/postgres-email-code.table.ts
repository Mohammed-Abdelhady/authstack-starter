import { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, Date>;

export interface EmailCodesTable {
  id: Generated<string>;
  owner_id: string;
  purpose: string;
  email: string;
  code_hash: string;
  wrong_guesses: Generated<number>;
  expires_at: Timestamp;
  spent_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}
