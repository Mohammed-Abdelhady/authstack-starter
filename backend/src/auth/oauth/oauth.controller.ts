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
import { OAuthProviderSummary } from './oauth-provider.interface';
import { toCallbackParams } from './utils/callback-params.util';
import { BrowserOAuthFlow } from './browser-oauth-flow';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';

/**
 * Fetch starts return the provider address; navigation starts and callbacks
 * redirect through the provider and back to the selected client.
 */
@ApiTags('oauth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly registry: OAuthRegistryService,
    private readonly flow: BrowserOAuthFlow,
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
      const url = await this.flow.start({
        providerId,
        redirect,
        intent,
        request,
        response,
        clientId: WEB_CLIENT_ID,
      });
      response.redirect(HttpStatus.FOUND, url);
    } catch (error) {
      this.flow.startError(response, error, providerId);
    }
  }

  @Public()
  @Post(':provider/start')
  @ApiOperation({
    summary: 'Start OAuth for the requesting browser application',
  })
  async startFetch(
    @Param('provider') providerId: string,
    @Query('redirect') redirect: string | undefined,
    @Query('intent') intent: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponse<{ url: string }>> {
    return ApiResponse.success({
      url: await this.flow.start({
        providerId,
        redirect,
        intent,
        request,
        response,
      }),
    });
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
    await this.flow.callback(
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
    await this.flow.callback(
      providerId,
      toCallbackParams(body),
      request,
      response,
    );
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
