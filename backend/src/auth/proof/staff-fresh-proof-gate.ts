import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import { ApplicationPolicyReader } from '../contracts/application-policy';
import { FreshProofCheck } from '../contracts/fresh-proof';
import { FreshProofGate, type FreshProofRequirement } from './fresh-proof-gate';
import { SessionProofStore } from './stores/session-proof.store';
import type { ActingSession } from './types/acting-session';
import { freshProofRefusal } from './utils/fresh-proof-refusal';

@Injectable()
export class StaffFreshProofGate extends FreshProofGate {
  constructor(
    private readonly proofs: SessionProofStore,
    private readonly policies: ApplicationPolicyReader,
    private readonly check: FreshProofCheck,
  ) {
    super();
  }

  async assertFresh(
    unitOfWork: UnitOfWork,
    session: ActingSession,
    requirement: FreshProofRequirement,
  ): Promise<void> {
    const act = await this.proofs.readProof(unitOfWork, session);
    const policy = await this.policies.requireEnabled(
      unitOfWork,
      session.clientId,
    );
    const fresh = await this.check.isFresh(unitOfWork, {
      ...session,
      requirement,
      requirePasskey: policy.requirePasskey === true,
      rpId: policy.passkeyRelyingParty?.rpId,
      act: act ?? undefined,
    });
    if (!fresh) throw freshProofRefusal(policy);
  }
}
