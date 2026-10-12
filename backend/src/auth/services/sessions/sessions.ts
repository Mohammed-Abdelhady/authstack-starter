import { Injectable, Logger } from '@nestjs/common';
import {
  AuthenticatedSession,
  AuthenticatedSessions,
} from '../../../session/authority/authenticated-session';
import { StoredSession } from '../../../session/authority/session-authority.store';
import { SessionValidator } from '../../../session/authority/session-validator';
import { SessionRevoker } from '../../../session/revocation/session-revoker';
import {
  SessionIssuanceService,
  IssuedBrowserSession,
} from '../../../session/services/session-issuance.service';
import { NativeSessionRevocationService } from '../../../session/services/native-session-revocation.service';

// Log lines keep the context they were written under before this class existed.
const LOG_CONTEXT = 'SessionService';

/**
 * Sessions as the routes use them: issue, validate, list and end. Ids are
 * text, and what comes back is a plain record.
 */
@Injectable()
export class Sessions {
  private readonly logger = new Logger(LOG_CONTEXT);

  constructor(
    private readonly issuance: SessionIssuanceService,
    private readonly validator: SessionValidator,
    private readonly authenticated: AuthenticatedSessions,
    private readonly revoker: SessionRevoker,
    private readonly nativeRevocation: NativeSessionRevocationService,
  ) {}

  async createSession(
    userId: string,
    userAgent: string,
    ip: string,
  ): Promise<IssuedBrowserSession> {
    const issued = await this.issuance.createBrowserSession(
      userId,
      userAgent,
      ip,
    );
    this.logger.log(`Session created for user ${userId}`);
    return issued;
  }

  async validateSession(token: string): Promise<AuthenticatedSession | null> {
    return this.authenticated.of(
      await this.validator.validateByToken(token, true),
    );
  }

  async validateSessionWithoutExtendingIdle(
    token: string,
  ): Promise<AuthenticatedSession | null> {
    return this.authenticated.of(
      await this.validator.validateByToken(token, false),
    );
  }

  async invalidateSession(token: string): Promise<boolean> {
    const revoked = await this.revoker.revokeByToken(token);
    this.logger.log(`Session invalidated: ${revoked ? 1 : 0} document(s)`);
    return revoked;
  }

  async invalidateAllSessions(userId: string): Promise<number> {
    const count = await this.revoker.revokeAllForUser(userId);
    this.logger.log(
      `All sessions invalidated for user ${userId}: ${count} document(s)`,
    );
    return count;
  }

  async getUserSessions(userId: string): Promise<StoredSession[]> {
    return this.validator.listActive(userId);
  }

  async getSessionById(sessionId: string): Promise<StoredSession | null> {
    return this.validator.findById(sessionId);
  }

  async invalidateSessionById(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const revoked = await this.revoker.revokeById(sessionId, userId);
    if (revoked) {
      this.logger.log(`Session ${sessionId} invalidated for user ${userId}`);
    }
    return revoked;
  }

  async invalidateAllSessionsExceptSession(
    userId: string,
    exceptSessionId: string,
  ): Promise<number> {
    const count = await this.revoker.revokeAllOthersExceptSession(
      userId,
      exceptSessionId,
    );
    this.logger.log(
      `All sessions except current invalidated for user ${userId}: ${count} document(s)`,
    );
    return count;
  }

  async invalidateNativeSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const revoked = await this.nativeRevocation.revokeNativeSession(
      sessionId,
      userId,
    );
    this.logger.log(
      `Native session invalidated: ${revoked ? 1 : 0} document(s)`,
    );
    return revoked;
  }

  async getSessionByToken(token: string): Promise<StoredSession | null> {
    return this.validator.findByToken(token);
  }
}
