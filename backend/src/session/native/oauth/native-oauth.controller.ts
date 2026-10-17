import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import {
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../../../auth/decorators/public.decorator';
import { SkipBrowserProof } from '../../../auth/decorators/skip-browser-proof.decorator';
import { RequestWithUser } from '../../../auth/guards/auth.guard';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { CSRF_HEADER } from '../../constants/browser-proof';
import { SESSION_SWAGGER_AUTH_NAME } from '../../../common/constants/session';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import {
  NATIVE_DPOP_NONCE_HEADER,
  NATIVE_DPOP_PROOF_HEADER,
} from '../../constants/session-policy';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { NativeAuthorizeBrowserService } from '../authorize/native-authorize-browser.service';
import { NativeAuthorizeService } from '../authorize/native-authorize.service';
import { NativeTokenService } from '../token/native-token.service';
import { NativeAuthorizeActionDto } from '../authorize/dto/native-authorize.dto';
import {
  ApiNativeTokenExchange,
  ApiNativeAuthorizeApproveErrors,
  ApiNativeAuthorizeDenyErrors,
  ApiNativeAuthorizeStart,
  ApiNativeRevoke,
} from './native-oauth.swagger';
import { beginNativeBrowserAuthorization } from '../authorize/utils/native-browser-entry';
import { nativeBrowserProviderLookup } from '../authorize/utils/native-browser-provider-lookup';
import {
  OauthFailure,
  RevokeRequest,
  TokenRequest,
  TokenSuccess,
} from './native-oauth.types';
import {
  assertDisplayedAccount,
  readSessionCookie,
  requestIp,
  requestUserAgent,
} from './native-request';

@ApiTags('oauth')
@Controller('oauth')
export class NativeOAuthController {
  constructor(
    private readonly authorize: NativeAuthorizeService,
    private readonly authorizeBrowser: NativeAuthorizeBrowserService,
    private readonly tokens: NativeTokenService,
    private readonly config: ConfigService,
    private readonly authEpoch: AuthEpochService,
    private readonly moduleRef: ModuleRef,
  ) {}

  @Public()
  @SkipBrowserProof()
  @ApiNativeAuthorizeStart()
  @Get('authorize')
  async authorizeGet(
    @Query() query: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await beginNativeBrowserAuthorization(
      query,
      request.headers['accept-language'],
      {
        authorize: this.authorize,
        providers: nativeBrowserProviderLookup(this.moduleRef),
        clientUrl: this.authEpoch.clientUrl(),
      },
    );
    if (!result.ok) {
      this.writeError(response, result);
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(result.location);
  }

  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Read a native authorization request',
    description:
      'Returns the application name, platform, expiry, and current grant state. ' +
      'It never returns the callback URI, state, or PKCE challenge.',
  })
  @ApiParam({ name: 'id', description: 'Native authorization transaction id' })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          applicationName: 'Example Mobile App',
          platform: 'native',
          expiresAt: '2026-10-01T12:05:00.000Z',
          alreadyGranted: false,
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'A browser session is required' })
  @ApiForbiddenResponse({ description: 'Native sign-in is disabled' })
  @ApiNotFoundResponse({
    description: 'The transaction is unknown, expired, ended, or disabled',
  })
  @Get('authorize/transaction/:id')
  async transaction(
    @Param('id') transactionId: string,
    @Req() request: RequestWithUser,
    @Res() response: Response,
  ): Promise<void> {
    const userId = this.requireBrowserSession(request);
    const data = await this.authorizeBrowser.getTransaction(
      userId,
      transactionId,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.status(HttpStatus.OK).json({ success: true, data });
  }

  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Approve a native authorization request',
    description:
      'Atomically approves one pending request and returns its callback URI.',
  })
  @ApiBody({ type: NativeAuthorizeActionDto })
  @ApiHeader({
    name: CSRF_HEADER,
    required: true,
    description: 'Single-use browser proof',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: { redirectUri: 'myapp://callback?code=abc&state=xyz' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'A browser session is required' })
  @ApiNativeAuthorizeApproveErrors()
  @Post('authorize/approve')
  async approve(
    @Body() body: NativeAuthorizeActionDto,
    @Req() request: RequestWithUser,
    @Res() response: Response,
  ): Promise<void> {
    const userId = this.requireBrowserSession(request);
    assertDisplayedAccount(userId, body.expectedUserId);
    const transactionId = body.transactionId.trim();
    if (!transactionId) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Authorization approval is incomplete',
        HttpStatus.BAD_REQUEST,
      );
    }
    const approved = await this.authorize.approve(
      userId,
      transactionId,
      request.session?.authenticationMethods ?? [],
      request.session?.authenticatedAt,
      request.session,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.status(HttpStatus.OK).json({ success: true, data: approved });
  }

  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Deny a native authorization request',
    description:
      'Atomically denies one pending request and returns its callback URI.',
  })
  @ApiBody({ type: NativeAuthorizeActionDto })
  @ApiHeader({
    name: CSRF_HEADER,
    required: true,
    description: 'Single-use browser proof',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          redirectUri: 'myapp://callback?error=access_denied&state=xyz',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'A browser session is required' })
  @ApiNativeAuthorizeDenyErrors()
  @Post('authorize/deny')
  async deny(
    @Body() body: NativeAuthorizeActionDto,
    @Req() request: RequestWithUser,
    @Res() response: Response,
  ): Promise<void> {
    const userId = this.requireBrowserSession(request);
    assertDisplayedAccount(userId, body.expectedUserId);
    const denied = await this.authorizeBrowser.deny(body.transactionId);
    response.setHeader('Cache-Control', 'no-store');
    response.status(HttpStatus.OK).json({ success: true, data: denied });
  }

  @Public()
  @SkipBrowserProof()
  @ApiNativeTokenExchange()
  @Post('token')
  async token(
    @Body() body: TokenRequest,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (this.hasSessionCookie(request)) {
      this.writeError(response, {
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        error: 'invalid_request',
      });
      return;
    }
    const result = await this.tokens.grant(
      body,
      {
        ip: requestIp(request),
        userAgent: requestUserAgent(request),
      },
      request.get(NATIVE_DPOP_PROOF_HEADER),
    );
    this.writeToken(response, result);
  }

  @Public()
  @SkipBrowserProof()
  @ApiNativeRevoke()
  @Post('revoke')
  async revoke(
    @Body() body: RevokeRequest,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (this.hasSessionCookie(request)) {
      this.writeError(response, {
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        error: 'invalid_request',
      });
      return;
    }
    const result = await this.tokens.revoke(
      body,
      request.get(NATIVE_DPOP_PROOF_HEADER),
    );
    response.setHeader('Cache-Control', 'no-store');
    if (!result.ok) {
      if (result.dpopNonce) {
        response.setHeader(NATIVE_DPOP_NONCE_HEADER, result.dpopNonce);
      }
      this.writeError(response, result);
      return;
    }
    response.status(HttpStatus.OK).json({});
  }

  private hasSessionCookie(request: Request): boolean {
    return (
      readSessionCookie(
        request,
        this.config.get<string>('NODE_ENV'),
        this.config.get<string>('session.cookieName'),
      ) !== undefined
    );
  }

  private requireBrowserSession(request: RequestWithUser): string {
    if (
      request.user &&
      request.session?.credentialPurpose === CREDENTIAL_PURPOSE.BROWSER_SESSION
    ) {
      return request.user.id;
    }
    throw new AppException(
      ErrorCode.SESSION_REQUIRED,
      'Authentication required',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private writeToken(
    response: Response,
    result: TokenSuccess | OauthFailure,
  ): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    if (!result.ok) {
      if (result.dpopNonce) {
        response.setHeader(NATIVE_DPOP_NONCE_HEADER, result.dpopNonce);
      }
      this.writeError(response, result);
      return;
    }
    response.status(HttpStatus.OK).json({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    });
  }

  private writeError(response: Response, result: OauthFailure): void {
    response.setHeader('Cache-Control', 'no-store');
    if (result.error_description === undefined) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.status(result.status).json({
      error: result.error,
      error_description: result.error_description,
    });
  }
}
