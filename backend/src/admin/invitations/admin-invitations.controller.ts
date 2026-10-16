import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import { IdempotencyKey } from '../decorators/idempotency-key.decorator';
import { AdminInvitationsService } from './admin-invitations.service';
import { AdminInvitationDto } from './dto/admin-invitation.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationQueryDto } from './dto/invitation-query.dto';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/invitations')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminInvitationsController {
  constructor(private readonly invitations: AdminInvitationsService) {}

  @Get()
  @RequireAnyPermission(USER_PERMISSIONS.LIST_ALL, USER_PERMISSIONS.LIST_STAFF)
  @ApiOperation({ summary: 'List invitations in permitted audiences' })
  @ApiOkResponse({
    description: 'Invitations, total, page and pages in an API response',
  })
  list(
    @Query() query: InvitationQueryDto,
    @CurrentUser('permissions') permissions?: readonly string[],
  ) {
    return this.invitations.list(query, permissions);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAnyPermission(
    USER_PERMISSIONS.CREATE_ALL,
    USER_PERMISSIONS.CREATE_STAFF,
  )
  @ApiOperation({
    summary:
      'Invite an account. Administrator invitations require a fresh act.',
  })
  @ApiCreatedResponse({ type: AdminInvitationDto })
  create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser('id') id: string,
    @CurrentUser('role') role: string,
    @ActingSessionOf() session: ActingSession,
    @IdempotencyKey() key: string | undefined,
    @CurrentUser('permissions') permissions?: readonly string[],
  ) {
    return this.invitations.create(
      dto,
      { id, role, session, permissions },
      key,
    );
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(
    USER_PERMISSIONS.CREATE_ALL,
    USER_PERMISSIONS.CREATE_STAFF,
  )
  @ApiOperation({ summary: 'Replace an invitation and mail its new link' })
  @ApiOkResponse({ type: AdminInvitationDto })
  resend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') role: string,
    @ActingSessionOf() session: ActingSession,
    @CurrentUser('permissions') permissions?: readonly string[],
  ) {
    return this.invitations.resend(id, {
      id: actorId,
      role,
      session,
      permissions,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAnyPermission(
    USER_PERMISSIONS.CREATE_ALL,
    USER_PERMISSIONS.CREATE_STAFF,
  )
  @ApiOperation({ summary: 'Revoke an invitation' })
  @ApiNoContentResponse()
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('permissions') permissions?: readonly string[],
  ) {
    return this.invitations.revoke(id, { id: actorId, role, permissions });
  }
}
