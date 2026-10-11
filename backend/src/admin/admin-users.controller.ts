import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiParam,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { AdminUsersService } from './services/users/admin-users.service';
import { AdminUserCreateService } from './services/users/admin-user-create.service';
import { AdminUserQueriesService } from './services/users/admin-user-queries.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ApiResponse } from '../common/dto/api-response.dto';
import { AdminUserDto, UserListData } from './dto/admin-user-response.dto';
import { USER_PERMISSIONS } from '../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { RouteIdPipe } from '../common/pipes/route-id.pipe';

/**
 * Admin endpoints for user records.
 * Listing and reads cover the actor's own level and below; every mutation
 * needs the actor's level to exceed the target's level.
 */
@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users')
@UseGuards(PermissionGuard)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly adminUserCreateService: AdminUserCreateService,
    private readonly adminUserQueriesService: AdminUserQueriesService,
  ) {}

  /**
   * Create a new user.
   *
   * @example POST /admin/users
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(USER_PERMISSIONS.CREATE_ALL)
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
  ): Promise<ApiResponse<AdminUserDto>> {
    return this.adminUserCreateService.createUser(dto, actorRole, actorId);
  }

  /**
   * List users with pagination and filtering.
   *
   * @example GET /admin/users?page=1&limit=10&search=john&role=content-editor
   */
  @Get()
  @RequirePermissions(USER_PERMISSIONS.LIST_ALL)
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
  ): Promise<ApiResponse<UserListData>> {
    return this.adminUserQueriesService.listUsers(query, actorRole);
  }

  /**
   * Get a single user by ID.
   *
   * @example GET /admin/users/:id
   */
  @Get(':id')
  @RequirePermissions(USER_PERMISSIONS.READ_ALL)
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
  ): Promise<ApiResponse<AdminUserDto>> {
    return this.adminUserQueriesService.getUserById(id, actorRole);
  }

  /**
   * Update user name and email.
   *
   * @example PATCH /admin/users/:id
   */
  @Patch(':id')
  @RequirePermissions(USER_PERMISSIONS.UPDATE_ALL)
  @ApiOperation({
    summary: 'Update user information',
    description:
      'Updates user name and/or email. Cannot modify users at or above the ' +
      "actor's role level, and cannot modify the actor's own account. " +
      'Changing the email requires an admin actor and marks the account ' +
      'unverified until the new address confirms a fresh code.',
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
  ): Promise<ApiResponse<AdminUserDto>> {
    return this.adminUsersService.updateUser(id, dto, actorId, actorRole);
  }

  /**
   * Re-send the confirmation code for a user's current unverified address.
   *
   * @example POST /admin/users/:id/resend-email-change
   */
  @Post(':id/resend-email-change')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(USER_PERMISSIONS.UPDATE_ALL)
  @ApiOperation({
    summary: 'Resend an email change confirmation',
    description:
      'Re-sends the confirmation code for the account current unverified ' +
      'address. The address and its generation are unchanged; a fresh code ' +
      'is issued up to the per-address mail cap.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  async resendEmailChange(
    @Param('id', RouteIdPipe) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
  ): Promise<ApiResponse<{ message: string }>> {
    return this.adminUsersService.resendEmailChange(id, actorId, actorRole);
  }

  /**
   * Activate or deactivate a user.
   *
   * @example PATCH /admin/users/:id/status
   */
  @Patch(':id/status')
  @RequirePermissions(USER_PERMISSIONS.UPDATE_ALL)
  @ApiOperation({
    summary: 'Update user status',
    description:
      'Activates or deactivates a user. Cannot modify users at or above the ' +
      "actor's role level, and cannot modify the actor's own account.",
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
  ): Promise<
    ApiResponse<{ id: string; isDeleted: boolean; deletedAt?: Date }>
  > {
    return this.adminUsersService.updateUserStatus(id, dto, actorId);
  }

  /**
   * Change a user's role.
   *
   * @example PATCH /admin/users/:id/role
   */
  @Patch(':id/role')
  @RequirePermissions(USER_PERMISSIONS.UPDATE_ALL)
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
  ): Promise<ApiResponse<{ id: string; role: string }>> {
    return this.adminUsersService.updateUserRole(id, dto, actorId, actorRole);
  }

  /**
   * Soft delete a user.
   *
   * @example DELETE /admin/users/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(USER_PERMISSIONS.DELETE_ALL)
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
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    return this.adminUsersService.deleteUser(id, actorId);
  }
}
