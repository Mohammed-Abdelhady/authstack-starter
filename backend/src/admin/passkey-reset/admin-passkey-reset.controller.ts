// feature:passkeys:start
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StaffGuard } from '../../auth/guards/staff.guard';
import { ActingSessionOf } from '../../auth/proof/decorators/acting-session.decorator';
import type { ActingSession } from '../../auth/proof/types/acting-session';
import { USER_PERMISSIONS } from '../../common/constants/permissions';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RouteIdPipe } from '../../common/pipes/route-id.pipe';
import { AdminPasskeyResetService } from './admin-passkey-reset.service';
import { PasskeyResetDto } from './dto/passkey-reset.dto';
import { RequiresFeature } from '../../auth/decorators/requires-feature.decorator';
import { AuthFeature } from '../../auth/enums/auth-feature.enum';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/users')
@RequiresFeature(AuthFeature.PASSKEYS)
@UseGuards(StaffGuard, PermissionGuard)
export class AdminPasskeyResetController {
  constructor(private readonly passkeys: AdminPasskeyResetService) {}

  @Post(':id/passkey-reset')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(
    USER_PERMISSIONS.UPDATE_ALL,
    USER_PERMISSIONS.UPDATE_STAFF,
  )
  @ApiOperation({
    summary: 'Remove passkeys, end sessions and mail an enrolment link',
  })
  @ApiOkResponse({
    description: 'API response containing id, revokedSessions and version',
  })
  reset(
    @Param('id', RouteIdPipe) id: string,
    @Body() dto: PasskeyResetDto,
    @CurrentUser('id') actorId: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') permissions?: readonly string[],
  ) {
    return this.passkeys.reset(
      { id, version: dto.version },
      { actorId, session, permissions },
    );
  }
}
// feature:passkeys:end
