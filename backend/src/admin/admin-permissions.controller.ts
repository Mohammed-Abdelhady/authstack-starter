import { StaffGuard } from '../auth/guards/staff.guard';
import {
  Controller,
  Get,
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
import { AdminPermissionsService } from './services/roles/admin-permissions.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiResponse } from '../common/dto/api-response.dto';
import { GrantPermissionDto } from './dto/grant-permission.dto';
import { StaffVersionQueryDto } from './dto/staff-version.decorator';
import { ActingSessionOf } from '../auth/proof/decorators/acting-session.decorator';
import type { ActingSession } from '../auth/proof/types/acting-session';
import { PERMISSION_PERMISSIONS } from '../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { RouteIdPipe } from '../common/pipes/route-id.pipe';

/**
 * Admin endpoints for direct permission grants.
 * Grants and revokes need the actor's level to exceed the target's level.
 */
@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminPermissionsController {
  constructor(
    private readonly adminPermissionsService: AdminPermissionsService,
  ) {}

  /**
   * List the permissions granted to a user.
   *
   * @example GET /admin/users/:id/permissions
   */
  @Get(':id/permissions')
  @RequirePermissions(PERMISSION_PERMISSIONS.READ_ALL)
  @ApiOperation({
    summary: 'Get user permissions',
    description:
      'Returns all permissions assigned to a specific user. Only users at ' +
      "or below the actor's role level can be read.",
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  async getUserPermissions(
    @Param('id', RouteIdPipe) userId: string,
    @CurrentUser('role') actorRole: string,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<
    ApiResponse<{
      userId: string;
      permissions: string[];
      role: string;
      version: number;
    }>
  > {
    return this.adminPermissionsService.getUserPermissions(
      userId,
      actorRole,
      actorPermissions,
    );
  }

  /**
   * Grant a permission to a user.
   *
   * @example POST /admin/users/:id/permissions
   */
  @Post(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSION_PERMISSIONS.GRANT_ALL)
  @ApiOperation({
    summary: 'Add permission to user',
    description:
      'Adds a direct permission in the format resource:action[:scope]. ' +
      'The wildcard cannot be granted here, and the actor must hold the ' +
      'permission itself. Cannot target the actor itself or a user at or ' +
      "above the actor's role level.",
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: GrantPermissionDto })
  async addPermission(
    @Param('id', RouteIdPipe) userId: string,
    @Body() dto: GrantPermissionDto,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<
    ApiResponse<{ userId: string; permissions: string[]; version: number }>
  > {
    return this.adminPermissionsService.addPermission(
      userId,
      dto.permission,
      actorId,
      actorRole,
      actorPermissions,
      { session, version: dto.version },
    );
  }

  /**
   * Revoke a permission from a user.
   *
   * @example DELETE /admin/users/:id/permissions/:permission
   */
  @Delete(':id/permissions/:permission')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSION_PERMISSIONS.REVOKE_ALL)
  @ApiOperation({
    summary: 'Remove permission from user',
    description:
      'Removes a direct permission from a user. Cannot target the actor ' +
      "itself or a user at or above the actor's role level.",
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiParam({
    name: 'permission',
    description: 'Permission to remove (URL encoded)',
    example: 'users:read:all',
  })
  async removePermission(
    @Param('id', RouteIdPipe) userId: string,
    @Param('permission') permission: string,
    @Query() query: StaffVersionQueryDto,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<
    ApiResponse<{ userId: string; permissions: string[]; version: number }>
  > {
    return this.adminPermissionsService.removePermission(
      userId,
      permission,
      actorId,
      actorRole,
      actorPermissions,
      { session, version: query.version },
    );
  }
}
