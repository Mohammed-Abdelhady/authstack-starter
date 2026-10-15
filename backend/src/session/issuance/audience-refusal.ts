import type { EventRecorder } from '../../auth/contracts/event-recorder';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../constants/security-event-action';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';
import { AudienceAdmissionRefused } from '../utils/authority/audience-admission';
import { PasskeyRequiredRefused } from '../utils/authority/passkey-sign-in';

/** Record a definite refusal only after the issuing unit of work has ended. */
export async function withAudienceRefusal<Result>(
  events: Pick<EventRecorder, 'recordOutsideUnitOfWork'>,
  userId: string,
  clientId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AudienceAdmissionRefused) {
      try {
        await events.recordOutsideUnitOfWork({
          action:
            error instanceof PasskeyRequiredRefused
              ? SECURITY_EVENT_ACTION.PASSKEY_REQUIRED
              : SECURITY_EVENT_ACTION.AUDIENCE_REFUSED,
          outcome: SECURITY_EVENT_OUTCOME.FAILED,
          targetUserId: userId,
          clientId,
        });
      } catch (eventError) {
        asAuthorityUnavailable(eventError);
      }
    }
    asAuthorityUnavailable(error);
  }
}
