import { DEVICE_KIND } from '../../common/constants/session';
import { CREDENTIAL_PURPOSE } from '../../session/constants/credential-purpose';
import { parseUserAgent } from '../../common/utils/parse-user-agent';
import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Sessions } from '../../auth/services/sessions/sessions';
import { SessionDto, SessionListData } from '../dto/user-profile.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { IdFormat } from '../../common/persistence/id-format';
import { assertValidId, isSameId } from '../utils/user-lookup.util';

/**
 * Self-service session management: listing a user's own sessions and
 * revoking them.
 */
@Injectable()
export class UserSessionsService {
  private readonly logger = new Logger(UserSessionsService.name);

  constructor(
    private readonly sessionService: Sessions,
    private readonly ids: IdFormat,
  ) {}

  /**
   * Get all active sessions for current user.
   */
  async getSessions(
    userId: string,
    currentSessionId: string | null,
  ): Promise<ApiResponse<SessionListData>> {
    assertValidId(this.ids, userId, 'Invalid user ID format');

    const sessions = await this.sessionService.getUserSessions(userId);

    const sessionDtos: SessionDto[] = sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      deviceName: session.deviceName ?? undefined,
      deviceParts: {
        ...parseUserAgent(session.userAgent).parts,
        ...(session.credentialPurpose === CREDENTIAL_PURPOSE.NATIVE_ACCESS
          ? { kind: DEVICE_KIND.MOBILE_APP }
          : {}),
      },
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt ?? undefined,
      isCurrent: currentSessionId !== null && session.id === currentSessionId,
      credentialPurpose: session.credentialPurpose,
    }));

    this.logger.log(
      `Retrieved ${sessions.length} sessions for user: ${userId}`,
    );
    return ApiResponse.success({
      sessions: sessionDtos,
      total: sessionDtos.length,
    });
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    currentSessionId: string | null,
  ): Promise<ApiResponse<{ message: string }>> {
    assertValidId(this.ids, userId, 'Invalid user ID format');
    assertValidId(this.ids, sessionId, 'Invalid session ID format');

    // Check if trying to revoke current session
    if (currentSessionId !== null && isSameId(currentSessionId, sessionId)) {
      throw new AppException(
        ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
        'Cannot revoke current session. Use logout instead.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const revoked = await this.sessionService.invalidateSessionById(
      sessionId,
      userId,
    );

    if (!revoked) {
      throw new AppException(
        ErrorCode.SESSION_NOT_FOUND,
        'Session not found or already revoked',
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log(`Session ${sessionId} revoked for user: ${userId}`);
    return ApiResponse.success({ message: 'Session revoked successfully' });
  }

  /**
   * Revoke all sessions except current.
   */
  async revokeAllOtherSessions(
    userId: string,
    currentSessionId: string | null,
  ): Promise<ApiResponse<{ revokedCount: number }>> {
    assertValidId(this.ids, userId, 'Invalid user ID format');

    if (currentSessionId === null) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Current session is no longer active',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const revokedCount =
      await this.sessionService.invalidateAllSessionsExceptSession(
        userId,
        currentSessionId,
      );

    this.logger.log(`Revoked ${revokedCount} sessions for user: ${userId}`);
    return ApiResponse.success({
      revokedCount,
    });
  }
}
