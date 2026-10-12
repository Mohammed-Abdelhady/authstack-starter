import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { LeanSession } from '../../../session/persistence/mongo/schemas/session.schema';
import {
  SessionIssuanceService,
  IssuedBrowserSession,
} from '../../../session/services/session-issuance.service';
import { SessionAuthorityService } from '../../../session/persistence/mongo/session-authority.service';
import { SessionRevocationService } from '../../../session/persistence/mongo/session-revocation.service';
import { NativeSessionRevocationService } from '../../../session/services/native-session-revocation.service';
import { hashToken } from '../../../session/utils/hashing/token-hash';

export { hashToken };

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly issuance: SessionIssuanceService,
    private readonly authority: SessionAuthorityService,
    private readonly revocation: SessionRevocationService,
    private readonly nativeRevocation: NativeSessionRevocationService,
  ) {}

  async createSession(
    userId: Types.ObjectId,
    userAgent: string,
    ip: string,
  ): Promise<IssuedBrowserSession> {
    const issued = await this.issuance.createBrowserSession(
      userId.toString(),
      userAgent,
      ip,
    );
    this.logger.log(`Session created for user ${userId.toString()}`);
    return issued;
  }

  async validateSession(token: string): Promise<LeanSession | null> {
    return this.authority.validate(token, { extendIdle: true });
  }

  async validateSessionWithoutExtendingIdle(
    token: string,
  ): Promise<LeanSession | null> {
    return this.authority.validate(token, { extendIdle: false });
  }

  async invalidateSession(token: string): Promise<boolean> {
    const revoked = await this.revocation.revokeByToken(token);
    this.logger.log(`Session invalidated: ${revoked ? 1 : 0} document(s)`);
    return revoked;
  }

  async invalidateAllSessions(userId: Types.ObjectId): Promise<number> {
    const count = await this.revocation.revokeAllForUser(userId);
    this.logger.log(
      `All sessions invalidated for user ${userId.toString()}: ${count} document(s)`,
    );
    return count;
  }

  async getUserSessions(userId: Types.ObjectId): Promise<LeanSession[]> {
    return this.authority.listActive(userId);
  }

  async getSessionById(sessionId: string): Promise<LeanSession | null> {
    return this.authority.getById(sessionId);
  }

  async invalidateSessionById(
    sessionId: string,
    userId: Types.ObjectId,
  ): Promise<boolean> {
    const revoked = await this.revocation.revokeById(sessionId, userId);
    if (revoked) {
      this.logger.log(
        `Session ${sessionId} invalidated for user ${userId.toString()}`,
      );
    }
    return revoked;
  }

  async invalidateAllSessionsExceptSession(
    userId: Types.ObjectId,
    exceptSessionId: string,
  ): Promise<number> {
    const count = await this.revocation.revokeAllOthersExceptSession(
      userId,
      exceptSessionId,
    );
    this.logger.log(
      `All sessions except current invalidated for user ${userId.toString()}: ${count} document(s)`,
    );
    return count;
  }

  async invalidateNativeSession(
    userId: Types.ObjectId,
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

  async getSessionByToken(token: string): Promise<LeanSession | null> {
    return this.authority.getByToken(token);
  }
}
