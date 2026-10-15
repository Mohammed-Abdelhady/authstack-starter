import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { VerifiedPasskeyProof } from './types/passkey-proof';

/** Defaults to legacy web-RP facts, or zero/false without passkeys; plan 3 adds RP storage. */
export abstract class PasskeyFacts {
  /** Advisory count only. Removal must retain SignInMethodRule.holdForRemoval. */
  abstract countForRelyingParty(
    unitOfWork: UnitOfWork,
    userId: string,
    rpId: string,
  ): Promise<number>;
  abstract userWasVerified(
    proof: VerifiedPasskeyProof | undefined,
    userId: string,
    rpId: string,
  ): boolean;
}
