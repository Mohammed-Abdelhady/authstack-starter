import { Injectable, Logger } from '@nestjs/common';
import { describeDriverError } from '../../common/utils/describe-error.util';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { REVOKED_REASON } from '../constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import { EnrolmentStore } from '../enrolment/enrolment.store';
import type { IssuanceApplication } from '../issuance/browser-issuance.store';
import { IssuanceApplications } from '../issuance/issuance-applications';
import {
  SESSION_REVOCATION,
  SessionRevocationStore,
} from '../revocation/session-revocation.store';
import { isValidDate } from '../utils/authority/session-authority-rule';
import {
  effectiveSessionDeadlines,
  sessionPastDeadline,
} from '../utils/session/session-deadlines';

const LOGGER = new Logger('SessionExpiry');

@Injectable()
export class SessionExpiry {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly sessions: EnrolmentStore,
    private readonly applications: IssuanceApplications,
    private readonly revocations: SessionRevocationStore,
    private readonly clock: Clock,
  ) {}

  async expireIfStillPastLimit(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.expire(sessionId, userId);
    } catch (error) {
      // The credential is already expired; retry persistence on its next use.
      LOGGER.warn(
        `Could not persist session expiry: ${describeDriverError(error)}`,
      );
    }
  }

  private async expire(sessionId: string, userId: string): Promise<void> {
    await this.runner.run(async (work) => {
      const account = await this.revocations.readAccountForRevocation(
        work,
        userId,
      );
      if (!account) return;
      const found = await this.revocations.findSessionOfAccount(
        work,
        sessionId,
        userId,
      );
      if (!found?.isValid || found.revoked) return;

      // Read inside this unit of work, after it took the session: a committed
      // idle extension wins, and no second pooled connection is needed.
      const session = await this.sessions.readSessionIn(work, sessionId);
      if (!session || !session.isValid || session.revokedAt) return;
      if (
        !isValidDate(session.authenticatedAt) ||
        !isValidDate(session.expiresAt) ||
        !isValidDate(session.idleExpiresAt) ||
        !isValidDate(session.lastActivityAt)
      ) {
        return;
      }
      const application = await this.enabledApplication(work, session.clientId);
      if (!application) return;
      const now = this.clock.now();
      if (
        !sessionPastDeadline(
          effectiveSessionDeadlines(session, application),
          now,
        )
      ) {
        return;
      }
      const result = await this.revocations.revokeSession(work, sessionId, {
        at: now,
        reason: REVOKED_REASON.EXPIRED,
      });
      if (result === SESSION_REVOCATION.REVOKED) {
        await this.revocations.appendSecurityEvent(work, {
          action: SECURITY_EVENT_ACTION.SESSION_REVOKED,
          reasonCode: REVOKED_REASON.EXPIRED,
          targetUserId: userId,
          clientId: session.clientId,
          sessionId,
        });
      }
    });
  }

  private async enabledApplication(
    work: UnitOfWork,
    clientId: string,
  ): Promise<IssuanceApplication | null> {
    try {
      return await this.applications.requireEnabled(work, clientId);
    } catch (error) {
      if (
        error instanceof AppException &&
        (error.code === ErrorCode.APPLICATION_DISABLED ||
          error.code === ErrorCode.APPLICATION_NOT_FOUND)
      ) {
        return null;
      }
      throw error;
    }
  }
}
