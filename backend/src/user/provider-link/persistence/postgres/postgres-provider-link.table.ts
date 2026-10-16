import type { ColumnType, Generated } from 'kysely';

/** `0032_provider_revocations.sql`. */
export interface ProviderLinkTicketsTable {
  id: Generated<string>;
  ticket_hash: string;
  user_id: string;
  session_id: string;
  client_id: string;
  provider: string;
  nonce_digest: string;
  expires_at: ColumnType<Date, Date, Date>;
  spent_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}
