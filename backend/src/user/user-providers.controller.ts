import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { UserProfileService } from './services/user-profile.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
  ) {}

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
