import { INVITATION_PURPOSE } from './constants/invitations';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { THROTTLE_MAGIC_LINK_VERIFY } from '../../common/constants/throttle';
import { Public } from '../decorators/public.decorator';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { InvitationAcceptService } from './services/invitation-accept.service';

@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationsController {
  constructor(private readonly acceptance: InvitationAcceptService) {}

  @Public()
  @Throttle(THROTTLE_MAGIC_LINK_VERIFY)
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Spends the invitation once and sets the application session cookie and CSRF header. Account invitations create the account. Enrolment links grant a 15-minute passkey enrolment session.',
  })
  @ApiBody({ type: AcceptInvitationDto })
  @ApiBadRequestResponse({
    description:
      'INVITATION_INVALID for an unknown, accepted, revoked or expired token, or withdrawn invitation authority',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['purpose', 'enrolment', 'user'],
      properties: {
        purpose: {
          type: 'string',
          enum: Object.values(INVITATION_PURPOSE),
        },
        enrolment: { type: 'boolean' },
        user: {
          type: 'object',
          required: ['id', 'email', 'name', 'role'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  })
  accept(
    @Body() dto: AcceptInvitationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.acceptance.accept(dto.token, request, response);
  }
}
