import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiCookieAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserProfileService } from './services/user-profile.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/guards/auth.guard';
import { ProviderLinkService } from './provider-link/provider-link.service';
import { THROTTLE_PROVIDER_LINK } from './provider-link/constants/provider-link.constants';
import {
  FinishProviderLinkDto,
  ProviderLinkStartDto,
  StartProviderLinkDto,
} from './provider-link/dto/provider-link.dto';
import { providerLinkCaller } from './provider-link/utils/provider-link-caller';
import { UserProfileDto } from './dto/user-profile.dto';
import {
  SetPrimaryProviderDto,
  LinkedProvidersResponseDto,
} from './dto/account-linking.dto';
import { ApiResponse } from '../common/dto/api-response.dto';
import { AccountLinkingService } from './services/account-linking.service';
import { ProfileSyncService } from './services/profile-sync.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/enums/error-code.enum';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';

/**
 * Controller for OAuth provider linking and profile synchronization.
 * All endpoints require authentication.
 */
@ApiTags('user')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('user')
export class UserProvidersController {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly accountLinkingService: AccountLinkingService,
    private readonly profileSyncService: ProfileSyncService,
    private readonly providerLinks: ProviderLinkService,
  ) {}

  /**
   * Starts linking a provider from a mobile app.
   *
   * @example POST /user/providers/link/start
   */
  @Post('providers/link/start')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PROVIDER_LINK)
  @ApiOperation({
    summary: 'Start linking a provider from an app',
    description:
      'Needs a fresh proof (REAUTH_REQUIRED otherwise). Ordinary apps accept ' +
      'a browser or native session authenticated within the last five minutes, ' +
      'using actual authentication time rather than credential issuance. ' +
      'Required-passkey apps need a persisted RP-bound UV proof. ' +
      'Answers a link id and a nonce digest bound to this account, this session ' +
      "and the provider, for the app's native provider prompt. Refused with " +
      'PROVIDER_ALREADY_LINKED, or FEATURE_DISABLED when this app does not ' +
      'offer the provider natively.',
  })
  @ApiBody({ type: StartProviderLinkDto })
  @ApiOkResponse({ type: ProviderLinkStartDto })
  async startProviderLink(
    @Req() request: RequestWithUser,
    @Body() dto: StartProviderLinkDto,
  ): Promise<ApiResponse<ProviderLinkStartDto>> {
    return ApiResponse.success(
      await this.providerLinks.start(providerLinkCaller(request), dto.provider),
    );
  }

  /**
   * Finishes a link with the provider's proof.
   *
   * @example POST /user/providers/link/finish
   */
  @Post('providers/link/finish')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PROVIDER_LINK)
  @ApiOperation({
    summary: 'Finish linking a provider from an app',
    description:
      'Takes the link id and the proof the provider made with its nonce, once. ' +
      'An unknown, spent or lapsed link, one of another session, or a proof for ' +
      'another nonce is refused with OAUTH_STATE_INVALID. An identity that ' +
      'belongs to another account is refused with OAUTH_ACCOUNT_LINKED_ELSEWHERE ' +
      'and nothing changes. The address the provider reports may differ from ' +
      "the account's.",
  })
  @ApiBody({ type: FinishProviderLinkDto })
  async finishProviderLink(
    @Req() request: RequestWithUser,
    @Body() dto: FinishProviderLinkDto,
  ): Promise<ApiResponse<UserProfileDto>> {
    const caller = providerLinkCaller(request);
    await this.providerLinks.finish(caller, dto.linkId, dto.credential);
    return this.userProfileService.getProfile(caller.userId);
  }

  /**
   * Get all linked providers for current user.
   *
   * @example GET /user/linked-providers
   */
  @Get('linked-providers')
  @ApiOperation({
    summary: 'Get linked providers',
    description:
      'Returns the sign-in methods on the authenticated user account, and for ' +
      'each one whether an unlink, and choosing it as primary, would be ' +
      'accepted now. Says whether email sign-in can be used at present.',
  })
  async getLinkedProviders(
    @CurrentUser('id') userId: string,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<LinkedProvidersResponseDto>> {
    const providers =
      await this.accountLinkingService.getLinkedProviders(userId);

    const primaryProvider =
      await this.userProfileService.getPrimaryProvider(userId);

    const { unlinkHints, emailSignIn } =
      await this.accountLinkingService.signInMethodHints(userId, providers);

    const primaryHints = this.accountLinkingService.primaryHints(providers);

    return ApiResponse.success({
      providers,
      primaryProvider,
      unlinkHints,
      primaryHints,
      emailSignIn,
      nativeLinkMethods: await this.providerLinks.available(
        providerLinkCaller(request).clientId,
      ),
    });
  }

  /**
   * Removed: linking now runs through the backend OAuth callback.
   *
   * @deprecated Use GET /api/auth/oauth/{provider}/start
   */
  @Post('link-provider')
  @ApiOperation({
    deprecated: true,
    summary: 'Removed client side provider linking',
    description:
      'Always returns 410 Gone. The client side code exchange cannot validate OAuth state.',
  })
  linkProvider(): never {
    throw new AppException(
      ErrorCode.OAUTH_STATE_INVALID,
      'Client side provider linking was removed because it cannot validate state.',
      HttpStatus.GONE,
    );
  }

  /**
   * Unlink an OAuth provider from current user's account.
   *
   * @example DELETE /user/unlink-provider/:provider
   */
  @Delete('unlink-provider/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unlink OAuth provider',
    description:
      'Unlinks an OAuth provider from the authenticated user account. ' +
      'Cannot unlink the last authentication method.',
  })
  @ApiParam({
    name: 'provider',
    description: 'Registered OAuth provider id to unlink',
    example: 'github',
  })
  async unlinkProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
  ): Promise<ApiResponse<UserProfileDto>> {
    await this.accountLinkingService.unlinkProvider(userId, provider);

    return this.userProfileService.getProfile(userId);
  }

  /**
   * Set primary provider for profile synchronization.
   *
   * @example POST /user/set-primary-provider
   */
  @Post('set-primary-provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set primary provider',
    description:
      'Sets an OAuth provider as the primary provider for automatic profile synchronization. ' +
      'The provider must already be linked to the account.',
  })
  @ApiBody({ type: SetPrimaryProviderDto })
  async setPrimaryProvider(
    @CurrentUser('id') userId: string,
    @Body() dto: SetPrimaryProviderDto,
  ): Promise<ApiResponse<UserProfileDto>> {
    // Set primary provider
    await this.accountLinkingService.setPrimaryProvider(userId, dto.provider);

    // Return updated user profile
    return this.userProfileService.getProfile(userId);
  }

  /**
   * Get profile sync status for current user.
   *
   * @example GET /user/sync-status
   */
  @Get('sync-status')
  @ApiOperation({
    summary: 'Get profile sync status',
    description:
      'Returns profile synchronization status including last sync timestamp and primary provider.',
  })
  async getSyncStatus(@CurrentUser('id') userId: string): Promise<
    ApiResponse<{
      lastSyncedAt?: Date;
      lastSyncedProvider?: string;
      primaryProvider?: string;
      canSync: boolean;
    }>
  > {
    const status = await this.profileSyncService.getSyncStatus(userId);
    return ApiResponse.success(status);
  }

  /**
   * Initiate manual profile sync from primary provider.
   * Requires user to re-authenticate with OAuth.
   *
   * @example POST /user/sync-profile
   */
  @Post('sync-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate profile sync',
    description:
      'Initiates manual profile synchronization from the primary OAuth provider. ' +
      'Returns instructions to re-authenticate with OAuth for fresh profile data.',
  })
  async initiateProfileSync(@CurrentUser('id') userId: string): Promise<
    ApiResponse<{
      requiresOAuth: boolean;
      provider: string;
      message: string;
    }>
  > {
    const syncInstructions =
      await this.profileSyncService.initiateManualSync(userId);
    return ApiResponse.success(syncInstructions);
  }
}
