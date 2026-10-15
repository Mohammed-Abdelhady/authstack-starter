import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../../session/constants/session-policy';
import { isValidDate } from '../../../session/utils/authority/session-authority-rule';
import { FreshProofCheck } from '../fresh-proof';
import {
  FRESH_PROOF_KIND,
  FRESH_PROOF_REQUIREMENT,
} from '../constants/fresh-proof';
import type { FreshProofInput } from '../types/fresh-proof';

@Injectable()
export class SessionFreshProofCheck extends FreshProofCheck {
  constructor(private readonly clock: Clock) {
    super();
  }

  isFresh(_unitOfWork: UnitOfWork, input: FreshProofInput): Promise<boolean> {
    return Promise.resolve(this.check(input));
  }

  private check(input: FreshProofInput): boolean {
    const now = this.clock.now().getTime();
    const recent = (date: Date): boolean =>
      isValidDate(date) &&
      date.getTime() <= now &&
      now - date.getTime() <= SENSITIVE_ACTION_WINDOW_MS;
    if (
      !input.userId ||
      !input.clientId ||
      !input.sessionId ||
      !isValidDate(input.signedInAt) ||
      input.signedInAt.getTime() > now
    ) {
      return false;
    }
    const act = input.act;
    if (act !== undefined) {
      if (
        act.userId !== input.userId ||
        act.clientId !== input.clientId ||
        act.sessionId !== input.sessionId ||
        !recent(act.provedAt) ||
        act.provedAt.getTime() < input.signedInAt.getTime()
      ) {
        return false;
      }
      if (act.kind === FRESH_PROOF_KIND.PASSKEY) {
        return Boolean(
          input.rpId && act.rpId === input.rpId && act.userVerified,
        );
      }
      return act.kind === FRESH_PROOF_KIND.EMAIL_CODE && !input.requirePasskey;
    }
    return (
      input.requirement === FRESH_PROOF_REQUIREMENT.ACT_OR_AGE &&
      !input.requirePasskey &&
      recent(input.signedInAt)
    );
  }
}
