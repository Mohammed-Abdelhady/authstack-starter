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
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { SkipBrowserProof } from '../decorators/skip-browser-proof.decorator';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { OAuthRegistryService } from './oauth-registry.service';
import { OAuthStateService } from './oauth-state.service';
import { OAuthService } from './oauth.service';
import {
  OAuthCallbackParams,
  OAuthProviderSummary,
} from './oauth-provider.interface';
import { sanitizeRedirectPath } from '../../common/utils/redirect.util';
import { requestLocaleOf } from '../../common/decorators/request-locale.decorator';
import { toCallbackParams } from './utils/callback-params.util';
import { OAuthRedirectService } from './oauth-redirect.service';

/**
 * Browser facing OAuth routes. Both `start` and `callback` answer with a 302:
 * the user is mid navigation, so failures land on the client error page rather
 * than on a JSON body.
 */
@ApiTags('oauth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly registry: OAuthRegistryService,
    private readonly stateService: OAuthStateService,
    private readonly oauthService: OAuthService,
    private readonly redirectService: OAuthRedirectService,
  ) {}

  @Public()
  @Get('providers')
  @ApiOperation({
    summary: 'List enabled OAuth providers',
    description:
      'Returns the providers that have credentials configured, as { id, displayName }.',
  })
  getProviders(): ApiResponse<{ providers: OAuthProviderSummary[] }> {
    return ApiResponse.success({ providers: this.registry.listEnabled() });
  }

  @Public()
  @Get(':provider/start')
  @ApiOperation({
    summary: 'Start an OAuth login',
    description:
      'Stores state, the PKCE verifier and the OIDC nonce in a signed short lived ' +
      'cookie, then redirects to the provider authorization endpoint.',
  })
  @ApiParam({
    name: 'provider',
    description: 'Provider id, for example google',
  })
  @ApiQuery({
    name: 'redirect',
    required: false,
    description: 'Relative path to return to after login',
  })
  @ApiQuery({
    name: 'intent',
    required: false,
    description: 'login (default) or link. link requires a signed-in session.',
  })
  async start(
    @Param('provider') providerId: string,
    @Query('redirect') redirect: string | undefined,
    @Query('intent') intent: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const strategy = this.registry.getEnabled(providerId);
      const linking = intent === 'link';
      const payloadIntent = linking ? 'link' : 'login';
      // The start is a same-site request, so the session cookie is here. The
      // callback is not, so the session is bound into the signed state now.
      const linkingSession = linking
        ? await this.oauthService.requireSession(request)
        : undefined;
      const { payload, codeChallenge } = this.stateService.create({
        redirect: sanitizeRedirectPath(redirect),
        supportsPkce: strategy.supportsPkce,
        usesOidc: strategy.usesOidc,
        intent: payloadIntent,
        linkUserId: linkingSession?.userId,
        linkSessionId: linkingSession?.sessionId,
      });

      const authorizationUrl = strategy.getAuthorizationUrl({
        state: payload.state,
        redirectUri: this.registry.getCallbackUrl(strategy.id),
        codeChallenge,
        nonce: payload.nonce,
      });

      this.stateService.write(
        response,
        strategy.id,
        payload,
        strategy.callbackMethod === 'POST',
      );
      response.redirect(HttpStatus.FOUND, authorizationUrl);
    } catch (error) {
      this.redirectService.toClientError(response, error, providerId);
    }
  }

  @Public()
  @Get(':provider/callback')
  @ApiOperation({
    summary: 'OAuth provider callback',
    description:
      'Validates the signed state cookie, exchanges the code, creates the session ' +
      'cookie and redirects to the client callback page.',
  })
  @ApiParam({
    name: 'provider',
    description: 'Provider id, for example google',
  })
  async callback(
    @Param('provider') providerId: string,
    @Query() query: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.handleCallback(
      providerId,
      toCallbackParams(query),
      request,
      response,
    );
  }

  @Public()
  @Post(':provider/callback')
  @SkipBrowserProof()
  @ApiOperation({
    summary: 'OAuth provider callback posted as a form',
    description:
      'Same handling as the GET callback, for providers that use response_mode=form_post. ' +
      'Apple posts code, state, id_token and, on the first authorization, a user JSON string. ' +
      'The request is cross site, so the state cookie is written with SameSite=None in production.',
  })
  @ApiParam({
    name: 'provider',
    description: 'Provider id, for example apple',
  })
  async callbackForm(
    @Param('provider') providerId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.handleCallback(
      providerId,
      toCallbackParams(body),
      request,
      response,
    );
  }

  private async handleCallback(
    providerId: string,
    params: OAuthCallbackParams,
    request: Request,
    response: Response,
  ): Promise<void> {
    let redirect: string | undefined;

    try {
      const strategy = this.registry.getEnabled(providerId);
      const payload = this.stateService.read(request, strategy.id);
      redirect = payload.redirect;
      this.stateService.assertStateMatches(payload, params.state, strategy.id);

      if (params.error) {
        throw new AppException(
          ErrorCode.OAUTH_AUTHENTICATION_FAILED,
          `Provider reported '${params.error}'`,
          HttpStatus.UNAUTHORIZED,
          { provider: strategy.id },
        );
      }

      if (!params.code) {
        throw new AppException(
          ErrorCode.OAUTH_CODE_INVALID,
          'Authorization code is missing',
          HttpStatus.BAD_REQUEST,
          { provider: strategy.id },
        );
      }

      const shared = {
        strategy,
        code: params.code,
        redirectUri: this.registry.getCallbackUrl(strategy.id),
        codeVerifier: payload.codeVerifier,
        nonce: payload.nonce,
        callbackParams: params,
        response,
        locale: requestLocaleOf(request),
      };

      if (payload.intent === 'link') {
        if (!payload.linkUserId || !payload.linkSessionId) {
          throw new AppException(
            ErrorCode.OAUTH_STATE_INVALID,
            'OAuth link intent is missing the signed-in user',
            HttpStatus.UNAUTHORIZED,
            { provider: strategy.id },
          );
        }
        await this.oauthService.link({
          ...shared,
          linkUserId: payload.linkUserId,
          linkSessionId: payload.linkSessionId,
        });
        this.stateService.clear(response, strategy.id);
        this.redirectService.toClientSuccess(response, payload.redirect);
        return;
      }

      const outcome = await this.oauthService.login(shared);

      this.stateService.clear(response, strategy.id);

      if (outcome.requiresTwoFactor) {
        this.redirectService.toTwoFactorChallenge(response, payload.redirect);
        return;
      }

      this.redirectService.toClientSuccess(response, payload.redirect);
    } catch (error) {
      this.stateService.clear(response, providerId);
      this.redirectService.toClientError(response, error, providerId, redirect);
    }
  }

  /**
   * @deprecated Replaced by GET /auth/oauth/:provider/start and
   * GET /auth/oauth/:provider/callback. The client side code exchange cannot
   * validate state, so it no longer runs.
   */
  @Public()
  @Post('callback')
  @ApiOperation({
    deprecated: true,
    summary: 'Removed client side OAuth callback',
    description:
      'Always returns 410 Gone. Use GET /auth/oauth/{provider}/start, which redirects ' +
      'through the provider to GET /auth/oauth/{provider}/callback.',
  })
  legacyCallback(): never {
    throw new AppException(
      ErrorCode.OAUTH_STATE_INVALID,
      'The client side OAuth callback was removed because it cannot validate state. ' +
        'Start the flow at GET /api/auth/oauth/{provider}/start.',
      HttpStatus.GONE,
    );
  }
}
