import type { AppException } from '../../../common/exceptions/app.exception';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../../../session/constants/security-event-action';
import { AudienceAdmissionRefused } from '../../../session/utils/authority/audience-admission';
import { PasskeyRequiredRefused } from '../../../session/utils/authority/passkey-sign-in';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import type { EventRecorder } from '../../contracts/event-recorder';

export async function nativeAudienceRefusal(
  error: unknown,
  events: Pick<EventRecorder, 'recordOutsideUnitOfWork'>,
  clientId: string,
  reply: () => AppException,
  targetUserId?: string,
): Promise<AppException | null> {
  const cause = storeFailureCause(error);
  if (!(cause instanceof AudienceAdmissionRefused)) return null;
  try {
    await events.recordOutsideUnitOfWork({
      action:
        cause instanceof PasskeyRequiredRefused
          ? SECURITY_EVENT_ACTION.PASSKEY_REQUIRED
          : SECURITY_EVENT_ACTION.AUDIENCE_REFUSED,
      outcome: SECURITY_EVENT_OUTCOME.FAILED,
      targetUserId,
      clientId,
    });
  } catch (recordingError) {
    asAuthorityUnavailable(recordingError);
  }
  return reply();
}
