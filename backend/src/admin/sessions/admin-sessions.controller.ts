import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StaffGuard } from '../../auth/guards/staff.guard';
import { SESSION_PERMISSIONS } from '../../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RouteIdPipe } from '../../common/pipes/route-id.pipe';
import { AdminSessionsService } from './admin-sessions.service';
import { AdminSessionListResponseDto } from './dto/admin-session-response.dto';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users/:id/sessions')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminSessionsController {
  constructor(private readonly sessions: AdminSessionsService) {}

  @Get()
  @RequirePermissions(SESSION_PERMISSIONS.READ_ALL)
  @ApiOkResponse({ type: AdminSessionListResponseDto })
  list(
    @Param('id', RouteIdPipe) id: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.sessions.list(id, actorId);
  }

  @Delete(':sessionId')
  @RequirePermissions(SESSION_PERMISSIONS.DELETE_ALL)
  revokeOne(
    @Param('id', RouteIdPipe) id: string,
    @Param('sessionId', RouteIdPipe) sessionId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.sessions.revokeOne(id, sessionId, actorId);
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SESSION_PERMISSIONS.DELETE_ALL)
  revokeAll(
    @Param('id', RouteIdPipe) id: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.sessions.revokeAll(id, actorId);
  }
}
