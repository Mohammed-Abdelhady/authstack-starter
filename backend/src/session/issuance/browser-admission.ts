import type { EventRecorder } from '../../auth/contracts/event-recorder';
import type { AccountCreationMethod } from '../../auth/types/account-creation';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';
import type { BrowserApplicationAdmission } from '../types/browser-application-admission';
import type { EnrolmentStore } from '../enrolment/enrolment.store';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../constants/security-event-action';
import { REVOKED_REASON } from '../constants/revoked-reason';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import type { AuthEpochService } from '../../common/services/auth-epoch.service';
import { APPLICATION_PLATFORM } from '../constants/client-ids';
import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type {
  BrowserIssuanceStore,
  IssuanceApplication,
} from './browser-issuance.store';
import type { IssuanceApplications } from './issuance-applications';
import { accountNotFound } from './session-issuance-errors';
import { assertAudienceAdmission } from '../utils/authority/audience-admission';
import { assertPasskeySignIn } from '../utils/authority/passkey-sign-in';

export async function assertBrowserAdmissionIn(
  work: UnitOfWork,
  userId: string,
  context: {
    store: BrowserIssuanceStore;
    applications: IssuanceApplications;
    clientId: string;
    admit?: BrowserApplicationAdmission | undefined;
  },
): Promise<number> {
  const account = await context.store.findAccount(work, userId);
  if (!account || account.isDeleted) throw accountNotFound();
  const application = await context.applications.requireEnabled(
    work,
    context.clientId,
  );
  context.admit?.(application);
  assertAudienceAdmission(account.accountAudience, application.accountAudience);
  assertPasskeySignIn(application.requirePasskey, undefined);
  return application.policyVersion ?? 0;
}

export function assertNativeIssuanceAllowed(
  application: IssuanceApplication,
  authEpoch: AuthEpochService,
): void {
  if (
    application.platform !== APPLICATION_PLATFORM.NATIVE ||
    authEpoch.nativeEnabled()
  )
    return;
  throw new AppException(
    ErrorCode.FEATURE_DISABLED,
    'Native session issuance is disabled',
    HttpStatus.FORBIDDEN,
  );
}

export async function replaceEnrolmentsIn(
  work: UnitOfWork,
  stores: { enrolments: EnrolmentStore; sessions: BrowserIssuanceStore },
  request: { userId: string; clientId: string; now: Date },
): Promise<void> {
  const ended = await stores.enrolments.replaceIn(
    work,
    request.userId,
    request.clientId,
    request.now,
  );
  for (const sessionId of ended)
    await stores.sessions.appendSecurityEvent(work, {
      targetUserId: request.userId,
      clientId: request.clientId,
      sessionId,
      action: SECURITY_EVENT_ACTION.SESSION_REVOKED,
      reasonCode: REVOKED_REASON.ENROLMENT_REPLACED,
    });
}

export async function recordCreationRefusal(
  events: Pick<EventRecorder, 'recordOutsideUnitOfWork'>,
  clientId: string,
  method: AccountCreationMethod,
): Promise<void> {
  try {
    await events.recordOutsideUnitOfWork({
      action: SECURITY_EVENT_ACTION.SIGN_UP_REFUSED,
      outcome: SECURITY_EVENT_OUTCOME.FAILED,
      clientId,
      reasonCode: method,
    });
  } catch (error) {
    asAuthorityUnavailable(error);
  }
}
