import type { RequestWithUser } from '../auth/guards/auth.guard';
import { StaffGuard } from '../auth/guards/staff.guard';
import {
  Controller,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
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
import { AdminUsersService } from './services/users/admin-users.service';
import { AdminUserCreateService } from './services/users/admin-user-create.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequireAnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResendEmailChangeDto } from './dto/resend-email-change.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ApiResponse } from '../common/dto/api-response.dto';
import { AdminUserDto } from './dto/admin-user-response.dto';
import { USER_PERMISSIONS } from '../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { RouteIdPipe } from '../common/pipes/route-id.pipe';
import { ActingSessionOf } from '../auth/proof/decorators/acting-session.decorator';
import type { ActingSession } from '../auth/proof/types/acting-session';
import { IdempotencyKey } from './decorators/idempotency-key.decorator';
import { StaffVersionQueryDto } from './dto/staff-version.decorator';
import type { StatusResult } from './services/users/admin-user-status';

/**
 * Admin endpoints for user records.
 * Listing and reads cover the actor's own level and below; every mutation
 * needs the actor's level to exceed the target's level.
 */
@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly adminUserCreateService: AdminUserCreateService,
  ) {}

  /** Create an account using the assigned role audience. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAnyPermission(
    USER_PERMISSIONS.CREATE_ALL,
    USER_PERMISSIONS.CREATE_STAFF,
  )
  @ApiOperation({
    summary: 'Create a new user',
    description:
      'Creates a new user account. The role must exist, sit below the ' +
      "actor's own role level and carry only permissions the actor holds. " +
      'ADMIN cannot be assigned through the API.',
  })
  @ApiBody({ type: CreateUserDto })
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser('role') actorRole: string,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
    @IdempotencyKey() key: string | undefined,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<ApiResponse<AdminUserDto>> {
    return this.adminUserCreateService.createUser(
      dto,
      actorRole,
      actorId,
      actorPermissions,
      { session, key },
    );
  }

  /**
   * Update user name and email.
   *
   * @example PATCH /admin/users/:id
   */
  @Patch(':id')
  @RequireAnyPermission(
    USER_PERMISSIONS.UPDATE_ALL,
    USER_PERMISSIONS.UPDATE_STAFF,
  )
  @ApiOperation({
    summary: 'Update user information',
    description:
      'Updates user name and/or email. Cannot modify users at or above the ' +
      "actor's role level, and cannot modify the actor's own account. " +
      'Changing the email requires an admin actor. The account keeps its ' +
      'address until the new one confirms the code mailed to it.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: UpdateUserDto })
  async updateUser(
    @Param('id', RouteIdPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<ApiResponse<AdminUserDto>> {
    return this.adminUsersService.updateUser(
      id,
      dto,
      actorId,
      actorRole,
      actorPermissions,
      session,
    );
  }

  /**
   * Re-send the confirmation code for the address a user waits to confirm.
   *
   * @example POST /admin/users/:id/resend-email-change
   */
  @Post(':id/resend-email-change')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(
    USER_PERMISSIONS.UPDATE_ALL,
    USER_PERMISSIONS.UPDATE_STAFF,
  )
  @ApiOperation({
    summary: 'Resend an email change confirmation',
    description:
      'Re-sends the confirmation code to the address the account waits to ' +
      'confirm. The address and its generation are unchanged; a fresh code ' +
      'is issued up to the per-address mail cap.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: ResendEmailChangeDto })
  async resendEmailChange(
    @Param('id', RouteIdPipe) id: string,
    @Body() dto: ResendEmailChangeDto,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser() actor: NonNullable<RequestWithUser['user']>,
  ): Promise<ApiResponse<{ message: string }>> {
    return this.adminUsersService.resendEmailChange(id, {
      actorId: actor.id,
      actorRole: actor.role,
      actorPermissions: actor.permissions,
      version: dto.version,
      session,
    });
  }

  /**
   * Activate or deactivate a user.
   *
   * @example PATCH /admin/users/:id/status
   */
  @Patch(':id/status')
  @RequireAnyPermission(
    USER_PERMISSIONS.SUSPEND_ALL,
    USER_PERMISSIONS.SUSPEND_STAFF,
  )
  @ApiOperation({
    summary: 'Update user status',
    description:
      'Suspends or restores a user, with the suspend permission for its ' +
      "audience. Cannot modify users at or above the actor's role level, " +
      "and cannot modify the actor's own account.",
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: UpdateUserStatusDto })
  async updateUserStatus(
    @Param('id', RouteIdPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<ApiResponse<StatusResult>> {
    return this.adminUsersService.updateUserStatus(
      id,
      dto,
      actorId,
      actorPermissions,
      session,
    );
  }

  /**
   * Change a user's role.
   *
   * @example PATCH /admin/users/:id/role
   */
  @Patch(':id/role')
  @RequireAnyPermission(
    USER_PERMISSIONS.ASSIGN_ROLE_ALL,
    USER_PERMISSIONS.ASSIGN_ROLE_STAFF,
  )
  @ApiOperation({
    summary: 'Update user role',
    description:
      'Assigns a system or custom role. The role must exist, sit below ' +
      "the actor's own level and carry only permissions the actor holds. " +
      'ADMIN cannot be assigned through the API.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: UpdateUserRoleDto })
  async updateUserRole(
    @Param('id', RouteIdPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<ApiResponse<{ id: string; role: string; version: number }>> {
    return this.adminUsersService.updateUserRole(
      id,
      dto,
      actorId,
      actorRole,
      actorPermissions,
      session,
    );
  }

  /** Soft delete a user inside the actor's audience scope. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAnyPermission(
    USER_PERMISSIONS.DELETE_ALL,
    USER_PERMISSIONS.DELETE_STAFF,
  )
  @ApiOperation({
    summary: 'Delete user',
    description:
      'Soft deletes a user account. Cannot delete users at or above the ' +
      "actor's role level, and cannot delete the actor's own account.",
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  async deleteUser(
    @Param('id', RouteIdPipe) id: string,
    @Query() query: StaffVersionQueryDto,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<void> {
    return this.adminUsersService.deleteUser(
      id,
      actorId,
      actorPermissions,
      session,
      query.version,
    );
  }
}
