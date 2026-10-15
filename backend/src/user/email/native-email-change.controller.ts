import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { SkipBrowserProof } from '../../auth/decorators/skip-browser-proof.decorator';
import { rejectBrowserContext } from '../../auth/native/utils/native-request.util';
import { THROTTLE_ACTIVATE } from '../../common/constants/throttle';
import { NativeEmailChangeConfirmDto } from './dto/native-email-change-confirm.dto';
import { NativeEmailChangeService } from './services/native-email-change.service';

/**
 * A mobile app confirms an address change for someone who may be signed out:
 * the mail's button opens the app, which sends the address and the code.
 */
@ApiTags('auth')
@Public()
@SkipBrowserProof()
@Controller('auth/native/email-change')
export class NativeEmailChangeController {
  constructor(private readonly changes: NativeEmailChangeService) {}

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_ACTIVATE)
  @ApiOperation({
    summary: 'Confirm an email change from a mobile app',
    description:
      'Takes a registered native client id, the new address and the code. ' +
      'It needs no browser proof and refuses a browser context. It moves the ' +
      'address and ends the account sessions, as the public route does.',
  })
  @ApiBody({ type: NativeEmailChangeConfirmDto })
  async confirm(
    @Req() request: Request,
    @Body() dto: NativeEmailChangeConfirmDto,
  ) {
    rejectBrowserContext(request);
    return this.changes.confirm(dto);
  }
}
