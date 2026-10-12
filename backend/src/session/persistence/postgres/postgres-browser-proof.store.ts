import { Kysely } from 'kysely';
import {
  BROWSER_PROOF_CLAIM,
  BROWSER_PROOF_CONSTRAINT,
  BrowserProofClaim,
  BrowserProofStore,
  IssuedBrowserProof,
  NewBrowserProof,
} from '../../proofs/browser-proof.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { autocommit } from '../../../auth/persistence/postgres/postgres-pending-codes-database';

const PROOF_CONSTRAINTS = {
  browser_proof_id_unique: BROWSER_PROOF_CONSTRAINT.PROOF_ID,
} as const;
const NO_CONSTRAINTS = {};

/** Every method is one statement on the pool, committed by itself. */
export class PostgresBrowserProofStore extends BrowserProofStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async issueBrowserProof(proof: NewBrowserProof): Promise<void> {
    await autocommit(PROOF_CONSTRAINTS, () =>
      this.database
        .insertInto('browser_proofs')
        .values({
          proof_id_hash: proof.proofIdHash,
          token_hash: proof.tokenHash,
          expires_at: proof.expiresAt,
        })
        .execute(),
    );
  }

  async findIssuedBrowserProof(
    proofIdHash: string,
  ): Promise<IssuedBrowserProof | null> {
    const row = await autocommit(NO_CONSTRAINTS, () =>
      this.database
        .selectFrom('browser_proofs')
        .select('token_hash')
        .where('proof_id_hash', '=', proofIdHash)
        .executeTakeFirst(),
    );
    return row ? { tokenHash: row.token_hash } : null;
  }

  async claimBrowserProof(
    proofIdHash: string,
    now: Date,
  ): Promise<BrowserProofClaim> {
    // The WHERE clause is the guard. A second writer waits for the first and
    // then sees the row spent, so it changes nothing and gets no row back.
    const claimed = await autocommit(NO_CONSTRAINTS, () =>
      this.database
        .updateTable('browser_proofs')
        .set({ spent: true })
        .where('proof_id_hash', '=', proofIdHash)
        .where('spent', '=', false)
        .where('expires_at', '>', now)
        .returning('id')
        .execute(),
    );
    if (claimed.length === 1) {
      return BROWSER_PROOF_CLAIM.CLAIMED;
    }
    const row = await autocommit(NO_CONSTRAINTS, () =>
      this.database
        .selectFrom('browser_proofs')
        .select(['spent', 'expires_at'])
        .where('proof_id_hash', '=', proofIdHash)
        .executeTakeFirst(),
    );
    if (!row) {
      return BROWSER_PROOF_CLAIM.NOT_FOUND;
    }
    if (row.spent) {
      return BROWSER_PROOF_CLAIM.ALREADY_CLAIMED;
    }
    return row.expires_at.getTime() <= now.getTime()
      ? BROWSER_PROOF_CLAIM.EXPIRED
      : BROWSER_PROOF_CLAIM.NOT_FOUND;
  }
}
