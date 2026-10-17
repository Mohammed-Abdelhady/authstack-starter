import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StaffGuard } from '../auth/guards/staff.guard';
import { RequireAnyPermission } from '../common/decorators/permissions.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ApiResponse } from '../common/dto/api-response.dto';
import { USER_PERMISSIONS } from '../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { RouteIdPipe } from '../common/pipes/route-id.pipe';
import { AdminUserDto, UserListData } from './dto/admin-user-response.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { AdminUserQueriesService } from './services/users/admin-user-queries.service';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminUserReadController {
  constructor(
    private readonly adminUserQueriesService: AdminUserQueriesService,
  ) {}

  /**
   * List users with pagination and filtering.
   *
   * @example GET /admin/users?page=1&limit=10&search=john&role=content-editor
   */
  @Get()
  @RequireAnyPermission(USER_PERMISSIONS.LIST_ALL, USER_PERMISSIONS.LIST_STAFF)
  @ApiOperation({
    summary: 'List all users',
    description:
      'Returns a paginated list of users with optional filtering by search, ' +
      "role and status. Covers every role at or below the actor's level, " +
      'custom roles included.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
    example: 1,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
    type: Number,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by email or name',
    example: 'john',
    type: String,
  })
  @ApiQuery({
    name: 'role',
    required: false,
    description: 'Filter by role slug',
    example: 'support',
    type: String,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by status (active, inactive, deleted)',
    enum: ['active', 'inactive', 'deleted'],
    example: 'active',
    type: String,
  })
  async listUsers(
    @Query() query: ListUsersQueryDto,
    @CurrentUser('role') actorRole: string,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<ApiResponse<UserListData>> {
    return this.adminUserQueriesService.listUsers(
      query,
      actorRole,
      actorPermissions,
    );
  }

  /** Read a user inside the actor's audience scope. */
  @Get(':id')
  @RequireAnyPermission(USER_PERMISSIONS.READ_ALL, USER_PERMISSIONS.READ_STAFF)
  @ApiOperation({
    summary: 'Get user by ID',
    description:
      'Returns detailed information about a specific user. ' +
      "Only users at or below the actor's role level can be read.",
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  async getUserById(
    @Param('id', RouteIdPipe) id: string,
    @CurrentUser('role') actorRole: string,
    @CurrentUser('permissions') actorPermissions?: readonly string[],
  ): Promise<ApiResponse<AdminUserDto>> {
    return this.adminUserQueriesService.getUserById(
      id,
      actorRole,
      actorPermissions,
    );
  }
}
