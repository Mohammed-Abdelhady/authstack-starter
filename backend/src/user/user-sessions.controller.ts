import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { UserSessionsService } from './services/user-sessions.service';
import { RequestWithUser } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionListData } from './dto/user-profile.dto';
import { ApiResponse } from '../common/dto/api-response.dto';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { requestSessionId } from '../session/utils/request/request-session';
import { RouteIdPipe } from '../common/pipes/route-id.pipe';

/**
 * Controller for user session management.
 * All endpoints require authentication.
 */
@ApiTags('user')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('user')
export class UserSessionsController {
  constructor(private readonly userSessionsService: UserSessionsService) {}

  /**
   * Get all active sessions for current user.
   *
   * @example GET /user/sessions
   */
  @Get('sessions')
  @ApiOperation({
    summary: 'Get user sessions',
    description:
      'Returns a list of all active sessions for the authenticated user, ' +
      'including the current session.',
  })
  async getSessions(
    @CurrentUser('id') userId: string,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<SessionListData>> {
    return this.userSessionsService.getSessions(
      userId,
      requestSessionId(request),
    );
  }

  /**
   * Revoke a specific session.
   *
   * @example DELETE /user/sessions/:sessionId
   */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a session',
    description:
      'Revokes a specific session by ID. Cannot revoke the current session.',
  })
  @ApiParam({
    name: 'sessionId',
    description: 'Session ID to revoke',
    example: '507f1f77bcf86cd799439011',
  })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId', RouteIdPipe) sessionId: string,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<{ message: string }>> {
    return this.userSessionsService.revokeSession(
      userId,
      sessionId,
      requestSessionId(request),
    );
  }

  /**
   * Revoke all sessions except current.
   *
   * @example POST /user/sessions/revoke-others
   */
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke all other sessions',
    description:
      'Revokes all sessions except the current one. Useful for security after password change.',
  })
  async revokeAllOtherSessions(
    @CurrentUser('id') userId: string,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<{ revokedCount: number }>> {
    return this.userSessionsService.revokeAllOtherSessions(
      userId,
      requestSessionId(request),
    );
  }
}
