import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StaffGuard } from '../../auth/guards/staff.guard';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import { USER_PERMISSIONS } from '../../common/constants/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErasureJobsListDto } from './dto/erasure-jobs.dto';
import { ErasureJobsAdminService } from './services/erasure-jobs-admin.service';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/erasure-jobs')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminErasureJobsController {
  constructor(private readonly admin: ErasureJobsAdminService) {}

  @Get()
  @RequirePermissions(USER_PERMISSIONS.DELETE_ALL)
  @ApiOperation({
    summary: 'List erasures that need a person',
    description:
      'Erasures that started and have not finished, with their step, ' +
      'attempts and failure code, and provider revocations flagged after ' +
      'five failures. An account in this list cannot sign in and cannot be ' +
      'restored.',
  })
  @ApiOkResponse({ type: ErasureJobsListDto })
  async list(): Promise<ApiResponse<ErasureJobsListDto>> {
    return ApiResponse.success(await this.admin.list());
  }
}
