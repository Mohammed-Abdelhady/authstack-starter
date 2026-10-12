import { Injectable } from '@nestjs/common';
import { MalformedIdError } from '../../common/persistence/persistence-errors';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import { REVOKED_REASON } from '../constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import { NativeCredentialStore } from '../native/credentials/native-credential.store';
import { NativeSecurityEvents } from '../native/credentials/native-security-events';
import {
  SESSION_REVOCATION,
  SessionRevocationStore,
} from '../revocation/session-revocation.store';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';

/** An account id as callers hold it: text, or a value that prints as it. */
type AccountId = string | { toString(): string };

/**
 * Signs a native caller out: revokes its session and the whole token family
 * issued for it, so neither the access nor the refresh token works again.
 */
@Injectable()
export class NativeSessionRevocationService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly credentials: NativeCredentialStore,
    private readonly sessions: SessionRevocationStore,
    private readonly events: NativeSecurityEvents,
    private readonly clock: Clock,
  ) {}

  async revokeNativeSession(
    sessionId: string,
    userId: AccountId,
  ): Promise<boolean> {
    try {
      return await this.unitOfWork.run((unitOfWork) =>
        this.revokeIn(unitOfWork, sessionId, userId.toString()),
      );
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  private async revokeIn(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const existing = await this.findSession(unitOfWork, sessionId, userId);
    if (
      !existing ||
      !existing.isValid ||
      existing.revoked ||
      existing.credentialPurpose !== CREDENTIAL_PURPOSE.NATIVE_ACCESS
    ) {
      return false;
    }
    const now = this.clock.now();
    const revoked = await this.sessions.revokeSession(unitOfWork, existing.id, {
      at: now,
      reason: REVOKED_REASON.CURRENT,
    });
    if (revoked !== SESSION_REVOCATION.REVOKED) {
      return false;
    }
    await this.credentials.revokeSessionCredentials(
      unitOfWork,
      existing.id,
      now,
    );
    await this.events.record(unitOfWork, {
      targetUserId: userId,
      clientId: existing.clientId,
      sessionId: existing.id,
      action: SECURITY_EVENT_ACTION.SESSION_REVOKED,
      reasonCode: REVOKED_REASON.CURRENT,
    });
    return true;
  }

  /** An id no session could have is the same as no session. */
  private async findSession(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ) {
    try {
      return await this.credentials.findSessionOfAccount(
        unitOfWork,
        sessionId,
        userId,
      );
    } catch (error) {
      if (error instanceof MalformedIdError) {
        return null;
      }
      throw error;
    }
  }
}
