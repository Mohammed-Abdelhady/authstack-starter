import type { Request } from 'express';
import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';
import { AuthFeature } from './enums/auth-feature.enum';
import { AuthFeaturesService } from './services/features/auth-features.service';
import { AuthMethodsResponseDto } from './dto/auth-methods-response.dto';
import { OAuthRegistryService } from './oauth/oauth-registry.service'; // feature:oauth-core
import { AudiencePolicy } from '../session/applications/audience-policy';
import { ApiResponse } from '../common/dto/api-response.dto';

/**
 * What this deployment accepts as a sign-in. Registered in AppModule, which is
 * where both the auth configuration and the OAuth registry are in scope.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthMethodsController {
  constructor(
    private readonly authFeaturesService: AuthFeaturesService,
    private readonly audiencePolicy: AudiencePolicy,
    private readonly oauthRegistry: OAuthRegistryService, // feature:oauth-core
  ) {}

  /**
   * List enabled sign-in methods
   * GET /api/auth/methods
   */
  @Public()
  @Get('methods')
  @ApiOperation({
    summary: 'List enabled sign-in methods',
    description:
      'Returns the password, magic link, two-factor and passkey switches ' +
      'together with the OAuth providers that have credentials, so a client ' +
      'renders only what works.',
  })
  getMethods(@Req() request?: Request): ApiResponse<AuthMethodsResponseDto> {
    return ApiResponse.success({
      audiencesEnabled: this.audiencePolicy.enabled(),
      methods: {
        password: this.authFeaturesService.isEnabledForRequest(
          AuthFeature.PASSWORD,
          request,
        ),
        // feature:email-code:start
        emailCode: this.authFeaturesService.isEnabledForRequest(
          AuthFeature.EMAIL_CODE,
          request,
        ),
        // feature:email-code:end
        // feature:magic-link:start
        magicLink: this.authFeaturesService.isEnabledForRequest(
          AuthFeature.MAGIC_LINK,
          request,
        ),
        // feature:magic-link:end
        // feature:totp:start
        twoFactor: this.authFeaturesService.isEnabledForRequest(
          AuthFeature.TWO_FACTOR,
          request,
        ),
        // feature:totp:end
        // feature:passkeys:start
        passkeys: this.authFeaturesService.isEnabledForRequest(
          AuthFeature.PASSKEYS,
          request,
        ),
        // feature:passkeys:end
        // feature:oauth-core:start
        oauth: this.authFeaturesService.isProviderSignInEnabledForRequest(
          request,
        )
          ? this.oauthRegistry.listEnabled()
          : [],
        // feature:oauth-core:end
      },
    });
  }
}
