import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  insertOrConflict,
  singleStatement,
} from '../../../common/persistence/mongo/mongo-unique-conflict';
import {
  BROWSER_PROOF_CLAIM,
  BROWSER_PROOF_CONSTRAINT,
  BrowserProofClaim,
  BrowserProofStore,
  IssuedBrowserProof,
  NewBrowserProof,
} from '../../proofs/browser-proof.store';
import {
  BrowserProof,
  BrowserProofDocument,
} from './schemas/browser-proof.schema';

const PROOF_CONSTRAINTS = {
  browser_proof_id_unique: BROWSER_PROOF_CONSTRAINT.PROOF_ID,
} as const;

@Injectable()
export class MongoBrowserProofStore extends BrowserProofStore {
  constructor(
    @InjectModel(BrowserProof.name)
    private readonly proofModel: Model<BrowserProofDocument>,
  ) {
    super();
  }

  async issueBrowserProof(proof: NewBrowserProof): Promise<void> {
    await insertOrConflict(PROOF_CONSTRAINTS, () =>
      this.proofModel.create({ ...proof, spent: false }),
    );
  }

  async findIssuedBrowserProof(
    proofIdHash: string,
  ): Promise<IssuedBrowserProof | null> {
    const proof = await singleStatement(() =>
      this.proofModel.findOne({ proofIdHash }).exec(),
    );
    return proof ? { tokenHash: proof.tokenHash } : null;
  }

  async claimBrowserProof(
    proofIdHash: string,
    now: Date,
  ): Promise<BrowserProofClaim> {
    // The filter is the guard: a write matches only while the proof is unspent.
    const claim = await singleStatement(() =>
      this.proofModel
        .updateOne(
          { proofIdHash, spent: false, expiresAt: { $gt: now } },
          { $set: { spent: true } },
        )
        .exec(),
    );
    if (claim.matchedCount === 1) {
      return BROWSER_PROOF_CLAIM.CLAIMED;
    }
    const proof = await singleStatement(() =>
      this.proofModel.findOne({ proofIdHash }).exec(),
    );
    if (!proof) {
      return BROWSER_PROOF_CLAIM.NOT_FOUND;
    }
    if (proof.spent) {
      return BROWSER_PROOF_CLAIM.ALREADY_CLAIMED;
    }
    return proof.expiresAt.getTime() <= now.getTime()
      ? BROWSER_PROOF_CLAIM.EXPIRED
      : BROWSER_PROOF_CLAIM.NOT_FOUND;
  }
}
