import { StaffGuard } from '../auth/guards/staff.guard';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import {
  RoleResponseDto,
  RoleListData,
  RoleUpdateResponseDto,
} from './dto/role-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ROLE_PERMISSIONS } from '../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { ApiResponse as ApiResponseDto } from '../common/dto/api-response.dto';
import { ActingSessionOf } from '../auth/proof/decorators/acting-session.decorator';
import type { ActingSession } from '../auth/proof/types/acting-session';
import { IdempotencyKey } from '../admin/decorators/idempotency-key.decorator';
import { StaffVersionQueryDto } from '../admin/dto/staff-version.decorator';

/**
 * Role management controller.
 * All endpoints require authentication and admin-level permissions.
 */
@ApiTags('roles')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('roles')
@UseGuards(StaffGuard, PermissionGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  /**
   * List all roles with optional pagination and search
   */
  @Get()
  @RequirePermissions(ROLE_PERMISSIONS.LIST_ALL)
  @ApiOperation({
    summary: 'List all roles',
    description:
      'Retrieve a paginated list of roles with optional search filtering.',
  })
  @ApiQuery({ type: ListRolesQueryDto })
  @ApiResponse({
    status: 200,
    description: 'Roles retrieved successfully',
    type: RoleListData,
  })
  async findAll(
    @Query() query: ListRolesQueryDto,
  ): Promise<ApiResponseDto<RoleListData>> {
    const data = await this.roleService.findAll(query);
    return {
      success: true,
      message: 'Roles retrieved successfully',
      data,
    };
  }

  /**
   * Get a single role by ID or slug
   */
  @Get(':idOrSlug')
  @RequirePermissions(ROLE_PERMISSIONS.READ_ALL)
  @ApiOperation({
    summary: 'Get role by ID or slug',
    description: 'Retrieve detailed information about a specific role.',
  })
  @ApiParam({
    name: 'idOrSlug',
    description: 'Role ID (MongoDB ObjectId) or slug',
    example: 'content-editor',
  })
  @ApiResponse({
    status: 200,
    description: 'Role retrieved successfully',
    type: RoleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found',
  })
  async findOne(
    @Param('idOrSlug') idOrSlug: string,
  ): Promise<ApiResponseDto<RoleResponseDto>> {
    const data = await this.roleService.findOne(idOrSlug);
    return {
      success: true,
      message: 'Role retrieved successfully',
      data,
    };
  }

  /**
   * Create a new role
   */
  @Post()
  @RequirePermissions(ROLE_PERMISSIONS.CREATE_ALL)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new role',
    description:
      'Create a custom role with specific permissions. The caller can only ' +
      'give the role permissions they hold themselves.',
  })
  @ApiResponse({
    status: 201,
    description: 'Role created successfully',
    type: RoleResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or permission format',
  })
  @ApiResponse({
    status: 403,
    description: 'A requested permission is not held by the caller',
  })
  @ApiResponse({
    status: 409,
    description: 'Role with this name already exists',
  })
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
    @IdempotencyKey() key: string | undefined,
  ): Promise<ApiResponseDto<RoleResponseDto>> {
    const data = await this.roleService.create(dto, actorId, { session, key });
    return {
      success: true,
      message: 'Role created successfully',
      data,
    };
  }

  /**
   * Update an existing role
   */
  @Patch(':idOrSlug')
  @RequirePermissions(ROLE_PERMISSIONS.UPDATE_ALL)
  @ApiOperation({
    summary: 'Update a role',
    description:
      'Update role name, description, or permissions. System roles keep their slug. ' +
      'Renaming a custom role moves every user assigned to it.',
  })
  @ApiParam({
    name: 'idOrSlug',
    description: 'Role ID or slug',
    example: 'content-editor',
  })
  @ApiResponse({
    status: 200,
    description: 'Role updated successfully',
    type: RoleUpdateResponseDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Cannot edit the admin role, rename a system role, edit a role at ' +
      'or above your own level, or add a permission you do not hold',
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found',
  })
  async update(
    @Param('idOrSlug') idOrSlug: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
  ): Promise<ApiResponseDto<RoleUpdateResponseDto>> {
    const data = await this.roleService.update(idOrSlug, dto, actorId, {
      session,
    });
    return {
      success: true,
      message: 'Role updated successfully',
      data,
    };
  }

  /**
   * Delete a role
   */
  @Delete(':idOrSlug')
  @RequirePermissions(ROLE_PERMISSIONS.DELETE_ALL)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a role',
    description:
      'Delete a role if no users are assigned to it. System and protected roles cannot be deleted.',
  })
  @ApiParam({
    name: 'idOrSlug',
    description: 'Role ID or slug',
    example: 'content-editor',
  })
  @ApiResponse({
    status: 204,
    description: 'Role deleted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete role with assigned users',
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot delete a system or protected role',
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found',
  })
  async delete(
    @Param('idOrSlug') idOrSlug: string,
    @Query() query: StaffVersionQueryDto,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
  ): Promise<void> {
    await this.roleService.delete(idOrSlug, actorId, {
      session,
      version: query.version,
    });
  }
}
