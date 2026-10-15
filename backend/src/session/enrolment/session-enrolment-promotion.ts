// feature:passkeys:start
import { Injectable } from '@nestjs/common';
import { EventRecorder } from '../../auth/contracts/event-recorder';
import { EnrolmentPromotion } from '../../auth/contracts/enrolment-promotion';
import type {
  EnrolmentPromotionInput,
  PromotedEnrolmentSession,
} from '../../auth/contracts/types/enrolment-promotion';
import type { IssuancePolicy } from '../../auth/contracts/types/application-policy';
import type { StoredSession } from '../authority/session-authority.store';
import { ApplicationPolicyReader } from '../../auth/contracts/application-policy';
import { FIRST_FACTOR } from '../../auth/services/sessions/first-factor';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { MalformedIdError } from '../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import { REVOKED_REASON } from '../constants/revoked-reason';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../constants/security-event-action';
import { BrowserIssuanceStore } from '../issuance/browser-issuance.store';
import { SessionIssuanceService } from '../services/session-issuance.service';
import { currentSessionDeadlines } from '../utils/authority/session-authority-rule';
import { EnrolmentStore } from './enrolment.store';
import { EnrolmentPromotionRefused } from './enrolment-promotion-refused';
import { AudienceAdmissionRefused } from '../utils/authority/audience-admission';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';

@Injectable()
export class SessionEnrolmentPromotion extends EnrolmentPromotion {
  private readonly receipts = new WeakMap<
    UnitOfWork,
    PromotedEnrolmentSession
  >();

  constructor(
    private readonly enrolments: EnrolmentStore,
    private readonly issuance: BrowserIssuanceStore,
    private readonly policy: ApplicationPolicyReader,
    private readonly issuer: SessionIssuanceService,
    private readonly clock: Clock,
    private readonly epoch: AuthEpochService,
    private readonly events: EventRecorder,
  ) {
    super();
  }

  async promoteAfterFirstPasskey(
    work: UnitOfWork,
    input: EnrolmentPromotionInput,
  ): Promise<void> {
    let session: StoredSession | null;
    try {
      session = await this.enrolments.readSessionIn(work, input.sessionId);
    } catch (error) {
      if (error instanceof MalformedIdError) throw invalidEnrolment();
      throw error;
    }
    if (
      !session ||
      session.userId !== input.userId ||
      session.clientId !== input.clientId
    ) {
      throw invalidEnrolment();
    }
    const account = await this.issuance.readAccountForIssuance(
      work,
      input.userId,
    );
    let application: IssuancePolicy;
    try {
      application = await this.policy.requireEnabled(work, input.clientId);
    } catch (error) {
      if (
        error instanceof AppException &&
        (error.code === ErrorCode.APPLICATION_DISABLED ||
          error.code === ErrorCode.APPLICATION_NOT_FOUND)
      ) {
        throw invalidEnrolment();
      }
      throw error;
    }
    const grant = await this.issuance.findGrant(
      work,
      input.userId,
      input.clientId,
    );
    if (
      session.policyVersion !== (application.policyVersion ?? 0) ||
      !currentSessionDeadlines(
        session,
        account,
        application,
        grant,
        this.clock.now(),
        this.epoch.current(),
        session.credentialPurpose,
      )
    ) {
      throw invalidEnrolment();
    }
    if (session.credentialPurpose !== CREDENTIAL_PURPOSE.ENROLMENT) return;
    if (
      input.proof.userId !== input.userId ||
      !input.proof.userVerified ||
      !input.proof.credentialId ||
      !application.passkeyRelyingParty ||
      input.proof.rpId !== application.passkeyRelyingParty.rpId
    ) {
      throw invalidEnrolment();
    }
    if (
      !(await this.enrolments.hasCredentialIn(
        work,
        input.userId,
        input.proof.credentialId,
      ))
    ) {
      throw invalidEnrolment();
    }
    const retired = await this.enrolments.retireIn(
      work,
      session.id,
      this.clock.now(),
    );
    if (!retired) throw invalidEnrolment();
    let issued: PromotedEnrolmentSession;
    try {
      issued = {
        ...(await this.issuer.createBrowserSessionIn(
          work,
          input.userId,
          session.userAgent,
          session.ip,
          input.clientId,
          {
            authenticationMethods: [FIRST_FACTOR.PASSKEY],
            userVerified: true,
          },
        )),
        clientId: input.clientId,
      };
    } catch (error) {
      if (error instanceof AudienceAdmissionRefused) {
        throw new EnrolmentPromotionRefused({
          userId: input.userId,
          clientId: input.clientId,
        });
      }
      if (
        error instanceof AppException &&
        error.code === ErrorCode.SESSION_LIMIT_REACHED
      ) {
        throw invalidEnrolment();
      }
      throw error;
    }
    await this.issuance.appendSecurityEvent(work, {
      targetUserId: input.userId,
      clientId: input.clientId,
      sessionId: session.id,
      action: SECURITY_EVENT_ACTION.SESSION_REVOKED,
      reasonCode: REVOKED_REASON.ENROLMENT_PROMOTED,
    });
    this.receipts.set(work, issued);
  }

  override async withRefusalRecorded<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof EnrolmentPromotionRefused && error.audience) {
        try {
          await this.events.recordOutsideUnitOfWork({
            action: SECURITY_EVENT_ACTION.AUDIENCE_REFUSED,
            outcome: SECURITY_EVENT_OUTCOME.FAILED,
            targetUserId: error.audience.userId,
            clientId: error.audience.clientId,
          });
        } catch (eventError) {
          asAuthorityUnavailable(eventError);
        }
      }
      throw error;
    }
  }

  override takePromotedSessionIn(work: UnitOfWork) {
    const receipt = this.receipts.get(work);
    this.receipts.delete(work);
    return receipt;
  }
}

function invalidEnrolment(): AppException {
  return new EnrolmentPromotionRefused();
}
// feature:passkeys:end
