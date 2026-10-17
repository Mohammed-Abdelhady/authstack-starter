import {
  Controller,
  Delete,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StaffGuard } from '../auth/guards/staff.guard';
import type { RequestWithUser } from '../auth/guards/auth.guard';
import { actingSessionOf } from '../auth/proof/decorators/acting-session.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequireAnyPermission } from '../common/decorators/permissions.decorator';
import { RouteIdPipe } from '../common/pipes/route-id.pipe';
import { USER_PERMISSIONS } from '../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { AdminUserDto } from './dto/admin-user-response.dto';
import { StaffVersionQueryDto } from './dto/staff-version.decorator';
import { AdminEmailCancellationService } from './services/users/admin-email-cancellation.service';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminUserEmailController {
  constructor(private readonly cancellation: AdminEmailCancellationService) {}

  @Delete(':id/email-change')
  @RequireAnyPermission(
    USER_PERMISSIONS.UPDATE_ALL,
    USER_PERMISSIONS.UPDATE_STAFF,
  )
  @ApiOperation({
    summary:
      'Cancel the pending address change. Requires current administrator authority, a version in strict mode, and an explicit act for an administrator peer',
  })
  @ApiOkResponse({ type: AdminUserDto })
  cancel(
    @Param('id', RouteIdPipe) id: string,
    @Query() query: StaffVersionQueryDto,
    @Req() request: RequestWithUser,
  ) {
    const actor = request.user;
    if (!actor) throw new UnauthorizedException();
    return this.cancellation.cancel({
      id,
      actorId: actor.id,
      actorRole: actor.role,
      actorPermissions: actor.permissions,
      session: actingSessionOf(request),
      version: query.version,
    });
  }
}
