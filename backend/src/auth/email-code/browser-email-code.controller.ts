import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  THROTTLE_MAGIC_LINK_REQUEST,
  THROTTLE_MAGIC_LINK_VERIFY,
} from '../../common/constants/throttle';
import { Public } from '../decorators/public.decorator';
import { RequiresFeature } from '../decorators/requires-feature.decorator';
import { AuthFeature } from '../enums/auth-feature.enum';
import { BrowserEmailCodeService } from './browser-email-code.service';
import {
  RequestBrowserEmailCodeDto,
  VerifyBrowserEmailCodeDto,
} from './browser-email-code.dto';

@Controller('auth/email-code')
@RequiresFeature(AuthFeature.EMAIL_CODE)
export class BrowserEmailCodeController {
  constructor(private readonly codes: BrowserEmailCodeService) {}

  @Public()
  @Post('request')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_MAGIC_LINK_REQUEST)
  request(
    @Body() dto: RequestBrowserEmailCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.codes.request(dto, request, response);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_MAGIC_LINK_VERIFY)
  verify(
    @Body() dto: VerifyBrowserEmailCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.codes.verify(dto, request, response);
  }
}
