import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiCookieAuth } from '@nestjs/swagger';
import { UserProfileService } from './services/user-profile.service';
import { RequestWithUser } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresFeature } from '../auth/decorators/requires-feature.decorator';
import { AuthFeature } from '../auth/enums/auth-feature.enum';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { ApiResponse } from '../common/dto/api-response.dto';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { requestSessionId } from '../session/utils/request/request-session';

/**
 * Controller for user profile and account lifecycle operations.
 * All endpoints require authentication.
 */
@ApiTags('user')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('user')
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  /**
   * Get current user's profile.
   *
   * @example GET /user/profile
   */
  @Get('profile')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the profile information of the authenticated user.',
  })
  async getProfile(
    @CurrentUser('id') userId: string,
  ): Promise<ApiResponse<UserProfileDto>> {
    return this.userProfileService.getProfile(userId);
  }

  /**
   * Update current user's profile.
   *
   * @example PATCH /user/profile
   */
  @Patch('profile')
  @ApiOperation({
    summary: 'Update user profile',
    description: 'Updates the profile information of the authenticated user.',
  })
  @ApiBody({ type: UpdateProfileDto })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<ApiResponse<UserProfileDto>> {
    return this.userProfileService.updateProfile(userId, dto);
  }

  /**
   * Change current user's password.
   * Requires current password verification.
   * Invalidates all other sessions.
   *
   * @example POST /user/password
   */
  @RequiresFeature(AuthFeature.PASSWORD)
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change user password',
    description:
      'Changes the user password. Requires current password for verification. ' +
      'Invalidates all other sessions after successful password change.',
  })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<{ message: string }>> {
    return this.userProfileService.changePassword(
      userId,
      dto,
      requestSessionId(request),
    );
  }

  /**
   * Deactivate (soft delete) current user's account.
   *
   * @example DELETE /user/account
   */
  @Delete('account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate user account',
    description:
      'Deactivates the authenticated user account and ends its sessions. ' +
      'An administrator can reactivate it. The last active administrator ' +
      'is refused with 403.',
  })
  async deactivateAccount(
    @CurrentUser('id') userId: string,
  ): Promise<ApiResponse<{ message: string }>> {
    return this.userProfileService.deactivateAccount(userId);
  }
}
