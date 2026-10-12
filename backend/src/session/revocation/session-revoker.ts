import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { MalformedIdError } from '../../common/persistence/persistence-errors';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { REVOKED_REASON } from '../constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import { RoleAssignmentEvent } from '../types/role-assignment-event';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';
import { hashToken } from '../utils/hashing/token-hash';
import {
  ACCOUNT_VERSION_ADVANCE,
  RevocableSession,
  SESSION_REVOCATION,
  SessionRevocationStore,
  SURVIVOR_PROMOTION,
} from './session-revocation.store';

/**
 * Who forced a session revocation and why, carried onto the security event so
 * an admin-forced sign-out is not mistaken for the user's own.
 */
export interface RevocationContext {
  actorId?: string;
  reasonCode?: string;
  roleAssignment?: RoleAssignmentEvent;
}

/**
 * Ends sessions. One session ends by its own guarded write. Every session of an
 * account ends when the account's version moves past the one they carry, and
 * "everywhere else" moves the kept session along with it in the same unit of
 * work.
 */
@Injectable()
export class SessionRevoker {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly store: SessionRevocationStore,
    private readonly clock: Clock,
  ) {}

  revokeByToken(token: string): Promise<boolean> {
    return this.run(async (unitOfWork) =>
      this.revokeFound(
        unitOfWork,
        await this.store.findLiveSessionByTokenHash(
          unitOfWork,
          hashToken(token),
        ),
        REVOKED_REASON.CURRENT,
      ),
    );
  }

  revokeById(sessionId: string, userId: string): Promise<boolean> {
    return this.run(async (unitOfWork) =>
      this.revokeFound(
        unitOfWork,
        await this.store.findLiveSessionOfAccount(
          unitOfWork,
          sessionId,
          userId,
        ),
        REVOKED_REASON.SELECTED,
      ),
    );
  }

  /** Ends every session of the account. Answers with how many were live. */
  revokeAllForUser(
    userId: string,
    context?: RevocationContext,
  ): Promise<number> {
    return this.run((unitOfWork) =>
      this.revokeAllForUserIn(unitOfWork, userId, context),
    );
  }

  /** The same, inside a unit of work the caller owns and commits. */
  async revokeAllForUserIn(
    unitOfWork: UnitOfWork,
    userId: string,
    context?: RevocationContext,
  ): Promise<number> {
    const account = await this.store.readAccountForRevocation(
      unitOfWork,
      userId,
    );
    if (!account) {
      return 0;
    }
    const count = await this.store.countLiveSessions(unitOfWork, {
      userId: account.id,
      userVersion: account.sessionVersion,
      now: this.clock.now(),
    });
    await this.store.advanceAccountVersion(unitOfWork, account.id);
    await this.store.appendSecurityEvent(unitOfWork, {
      actorId: context?.actorId,
      targetUserId: account.id,
      action: SECURITY_EVENT_ACTION.SESSIONS_REVOKED_ALL,
      reasonCode: context?.reasonCode ?? REVOKED_REASON.ALL_USER,
      roleAssignment: context?.roleAssignment,
    });
    return count;
  }

  /** Ends every session of the account but one. Answers with how many ended. */
  revokeAllOthersExceptSession(
    userId: string,
    keptSessionId: string,
  ): Promise<number> {
    return this.run((unitOfWork) =>
      this.revokeAllOthersExceptSessionIn(unitOfWork, userId, keptSessionId),
    );
  }

  /** The same, inside a unit of work the caller owns and commits. */
  async revokeAllOthersExceptSessionIn(
    unitOfWork: UnitOfWork,
    userId: string,
    keptSessionId: string,
  ): Promise<number> {
    const account = await this.store.readAccountForRevocation(
      unitOfWork,
      userId,
    );
    if (!account) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const survivor = await this.findSurvivor(
      unitOfWork,
      keptSessionId,
      account.id,
    );
    const currentVersion = account.sessionVersion;
    if (
      !survivor ||
      !survivor.isValid ||
      survivor.revoked ||
      survivor.userVersion !== currentVersion
    ) {
      throw sessionNoLongerActive();
    }

    const count = await this.store.countLiveSessions(unitOfWork, {
      userId: account.id,
      userVersion: currentVersion,
      now: this.clock.now(),
    });
    const advanced = await this.store.advanceAccountVersionFrom(
      unitOfWork,
      account.id,
      currentVersion,
    );
    if (advanced !== ACCOUNT_VERSION_ADVANCE.ADVANCED) {
      throw sessionNoLongerActive();
    }
    const promoted = await this.store.promoteSurvivor(unitOfWork, survivor.id, {
      from: currentVersion,
      to: currentVersion + 1,
    });
    if (promoted !== SURVIVOR_PROMOTION.PROMOTED) {
      throw sessionNoLongerActive();
    }

    await this.store.appendSecurityEvent(unitOfWork, {
      targetUserId: account.id,
      sessionId: survivor.id,
      action: SECURITY_EVENT_ACTION.SESSIONS_REVOKED_OTHERS,
      reasonCode: REVOKED_REASON.ALL_OTHER,
    });
    return Math.max(0, count - 1);
  }

  /** An id no session could carry names no session to keep. */
  private async findSurvivor(
    unitOfWork: UnitOfWork,
    keptSessionId: string,
    userId: string,
  ): Promise<RevocableSession | null> {
    try {
      return await this.store.findSessionOfAccount(
        unitOfWork,
        keptSessionId,
        userId,
      );
    } catch (error) {
      if (error instanceof MalformedIdError) {
        return null;
      }
      throw error;
    }
  }

  private async revokeFound(
    unitOfWork: UnitOfWork,
    found: RevocableSession | null,
    reason: string,
  ): Promise<boolean> {
    if (!found) {
      return false;
    }
    const outcome = await this.store.revokeSession(unitOfWork, found.id, {
      at: this.clock.now(),
      reason,
    });
    if (outcome !== SESSION_REVOCATION.REVOKED) {
      return false;
    }
    await this.store.appendSecurityEvent(unitOfWork, {
      targetUserId: found.userId,
      clientId: found.clientId,
      sessionId: found.id,
      action: SECURITY_EVENT_ACTION.SESSION_REVOKED,
      reasonCode: reason,
    });
    return true;
  }

  private async run<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.unitOfWork.run(work);
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }
}

function sessionNoLongerActive(): AppException {
  return new AppException(
    ErrorCode.SESSION_INVALID,
    'Current session is no longer active',
    HttpStatus.UNAUTHORIZED,
  );
}
