import { FRESH_PROOF_KIND } from '../../contracts/constants/fresh-proof';
import { FreshProofAct } from '../../contracts/types/fresh-proof';
import { ProofKind, ProofSessionRef } from '../types/session-proof';

export function storedProofAct(
  ref: ProofSessionRef,
  kind: ProofKind | null | undefined,
  rpId: string | null | undefined,
  userVerified: boolean,
  provedAt: Date | null | undefined,
): FreshProofAct | null {
  if (!provedAt) return null;
  if (kind === FRESH_PROOF_KIND.EMAIL_CODE) return { ...ref, kind, provedAt };
  if (kind !== FRESH_PROOF_KIND.PASSKEY || !rpId) return null;
  return { ...ref, kind, rpId, userVerified, provedAt };
}
