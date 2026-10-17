import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { StaffGuard } from '../../auth/guards/staff.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import { ACTIVITY_PERMISSIONS } from '../../common/constants/permissions';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AdminActivityService } from './admin-activity.service';
import {
  AdminActivityListData,
  AdminActivityResponseDto,
} from './dto/admin-activity-response.dto';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/activity')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminActivityController {
  constructor(private readonly activity: AdminActivityService) {}

  @Get()
  @RequirePermissions(ACTIVITY_PERMISSIONS.READ_ALL)
  @ApiOkResponse({ type: AdminActivityResponseDto })
  async list(
    @Query() query: Record<string, unknown>,
  ): Promise<ApiResponse<AdminActivityListData>> {
    return ApiResponse.success(await this.activity.list(query));
  }
}
