import type { ColumnType, Generated } from 'kysely';
import type { ProofKind } from '../../types/session-proof';

type Timestamp = ColumnType<Date, Date, Date>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;

export interface SessionProofsTable {
  session_id: string;
  user_id: string;
  client_id: string;
  challenge_kind: ProofKind | null;
  challenge_hash: string | null;
  challenge_expires_at: OptionalTimestamp;
  challenge_wrong_guesses: Generated<number>;
  proof_kind: ProofKind | null;
  proof_rp_id: string | null;
  proof_user_verified: Generated<boolean>;
  proved_at: OptionalTimestamp;
  purge_after: Timestamp;
}
