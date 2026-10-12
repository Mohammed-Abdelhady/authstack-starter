import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { MagicLinkService } from './magic-link.service';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { Public } from '../decorators/public.decorator';
import { RequiresFeature } from '../decorators/requires-feature.decorator';
import { AuthFeature } from '../enums/auth-feature.enum';
import {
  THROTTLE_MAGIC_LINK_REQUEST,
  THROTTLE_MAGIC_LINK_VERIFY,
} from '../../common/constants/throttle';

/**
 * Passwordless sign-in routes.
 *
 * The mailed link points at the client, which reads the token and posts it
 * here. There is no GET verify route: a link that signs in on a plain GET is
 * spent by the first mail scanner that follows it.
 */
@ApiTags('auth')
@Controller('auth/magic-link')
@RequiresFeature(AuthFeature.MAGIC_LINK)
export class MagicLinkController {
  constructor(private readonly magicLinkService: MagicLinkService) {}

  /**
   * Request a sign-in link
   * POST /api/auth/magic-link/request
   */
  @Public()
  @Throttle(THROTTLE_MAGIC_LINK_REQUEST)
  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a sign-in link',
    description:
      'Mails a one-time sign-in link. The reply is the same whether or not the ' +
      'address has an account, and whether or not a link was mailed. It sets ' +
      'an HttpOnly cookie that ties the link to this browser.',
  })
  @ApiBody({ type: RequestMagicLinkDto })
  async request(
    @Body() dto: RequestMagicLinkDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.magicLinkService.request(dto, request, response);
  }

  /**
   * Spend a sign-in link
   * POST /api/auth/magic-link/verify
   */
  @Public()
  @Throttle(THROTTLE_MAGIC_LINK_VERIFY)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with a link token',
    description:
      'Spends the token, sets the session cookie and returns the account. ' +
      'The token works once; a spent or expired one answers MAGIC_LINK_INVALID. ' +
      'In another browser than the one that asked, or over a session of ' +
      'another account, it answers requiresConfirmation with the masked ' +
      'address and spends nothing until it is sent again with confirm.',
  })
  @ApiBody({ type: VerifyMagicLinkDto })
  @ApiOkResponse({
    description: 'Signs in and optionally returns the validated continuation',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            requiresTwoFactor: { type: 'boolean' },
            user: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
            },
            requiresConfirmation: {
              type: 'boolean',
              description:
                'Present and true when the link was not spent and the person has to confirm',
            },
            email: {
              type: 'string',
              description:
                'Masked address of the link, present only with requiresConfirmation',
            },
            redirect: {
              type: 'string',
              description:
                'Present only when a native authorization continuation was stored',
            },
          },
          required: ['requiresTwoFactor', 'user'],
        },
        message: { type: 'string' },
      },
      required: ['success', 'data'],
    },
  })
  async verify(
    @Body() dto: VerifyMagicLinkDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.magicLinkService.verify(dto, request, response);
    return response.status(HttpStatus.OK).json(result);
  }
}
