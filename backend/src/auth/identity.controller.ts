import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiResponse } from '../common/dto/api-response.dto';
import { ErrorCode } from '../common/enums/error-code.enum';
import { AppException } from '../common/exceptions/app.exception';
import {
  NativeAccessService,
  readBearerToken,
} from '../session/native/access/native-access.service';
import { hasBothCredentials } from '../session/utils/request/request-credential';
import { UserProfileService } from '../user/services/user-profile.service';
import type { UserProfileDto } from '../user/dto/user-profile.dto';
import { Public } from './decorators/public.decorator';
import { SessionCookieService } from './services/sessions/session-cookie.service';
import { Sessions } from './services/sessions/sessions';

interface IdentityData {
  authenticated: boolean;
  user: UserProfileDto | null;
}

@ApiTags('auth')
@Controller('auth')
export class IdentityController {
  constructor(
    private readonly sessions: Sessions,
    private readonly cookies: SessionCookieService,
    private readonly nativeAccess: NativeAccessService,
    private readonly profiles: UserProfileService,
  ) {}

  @Public()
  @Get('identity')
  @ApiOperation({
    summary: 'Read the current account or a signed-out identity',
  })
  async identity(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponse<IdentityData>> {
    const cookie = this.cookies.read(request);
    const authorization = request.headers.authorization;
    const hasAuthorization = authorization !== undefined;
    if (hasBothCredentials(hasAuthorization, cookie !== undefined)) {
      throw new AppException(
        ErrorCode.MIXED_CREDENTIALS,
        'Use one credential per request',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!hasAuthorization && !cookie) {
      return ApiResponse.success({ authenticated: false, user: null });
    }

    const bearer = hasAuthorization ? readBearerToken(request) : null;
    if (hasAuthorization && bearer === null) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Invalid bearer credential',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = bearer
      ? await this.nativeAccess.validate(bearer)
      : await this.sessions.validateSession(cookie ?? '');
    if (!session || !session.user || session.user.isDeleted) {
      if (!hasAuthorization) this.cookies.clear(response);
      if (hasAuthorization) {
        throw new AppException(
          ErrorCode.SESSION_INVALID,
          'Invalid bearer credential',
          HttpStatus.UNAUTHORIZED,
        );
      }
      return ApiResponse.success({ authenticated: false, user: null });
    }

    try {
      const profile = await this.profiles.getProfile(session.user.id);
      return ApiResponse.success({ authenticated: true, user: profile.data });
    } catch (error) {
      if (
        !(error instanceof AppException) ||
        error.code !== ErrorCode.USER_NOT_FOUND
      ) {
        throw error;
      }
      if (hasAuthorization) {
        throw new AppException(
          ErrorCode.SESSION_INVALID,
          'Invalid bearer credential',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.cookies.clear(response);
      return ApiResponse.success({ authenticated: false, user: null });
    }
  }
}
