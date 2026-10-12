import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  NATIVE_DPOP_REVOKE_PATH,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../../constants/security-event-action';
import { NativeDpopService } from './native-dpop.service';
import type { NativeDpopVerification } from './native-dpop.service';
import { NativeSecurityEvents } from '../credentials/native-security-events';

export interface BoundProofEventContext {
  targetUserId?: string;
  sessionId: string;
  clientId: string;
}

@Injectable()
export class NativeBoundProofService {
  constructor(
    private readonly dpop: NativeDpopService,
    private readonly events: NativeSecurityEvents,
  ) {}

  verify(
    proof: string | undefined,
    token: string,
    thumbprint: string,
    endpoint: typeof NATIVE_DPOP_TOKEN_PATH | typeof NATIVE_DPOP_REVOKE_PATH,
    now: Date,
  ): NativeDpopVerification {
    return this.dpop.verifyBoundTokenProof(
      proof,
      token,
      thumbprint,
      endpoint,
      now,
    );
  }

  async reserve(unitOfWork: UnitOfWork, jti: string, now: Date): Promise<void> {
    await this.dpop.reserveProofId(unitOfWork, jti, now);
  }

  /** Without a unit of work the refusal commits by itself. */
  async recordRefusal(
    unitOfWork: UnitOfWork | undefined,
    context: BoundProofEventContext,
    reason: string,
  ): Promise<void> {
    const event = {
      ...context,
      action: SECURITY_EVENT_ACTION.NATIVE_DPOP_PROOF_REFUSED,
      reasonCode: reason,
      outcome: SECURITY_EVENT_OUTCOME.FAILED,
    };
    if (unitOfWork) {
      await this.events.record(unitOfWork, event);
      return;
    }
    await this.events.recordOutsideUnitOfWork(event);
  }
}
