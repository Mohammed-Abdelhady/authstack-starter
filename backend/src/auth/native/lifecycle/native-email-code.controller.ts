import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import {
  THROTTLE_MAGIC_LINK_REQUEST,
  THROTTLE_MAGIC_LINK_VERIFY,
} from '../../../common/constants/throttle';
import { RequestLocale } from '../../../common/decorators/request-locale.decorator';
import type { SupportedLocale } from '../../../common/constants/locales';
import { Public } from '../../decorators/public.decorator';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt';
import { rejectBrowserContext } from '../utils/native-request.util';
import { NativeEmailRequestDto } from './dto/native-email-request.dto';
import { NativeEmailCodeVerifyDto } from './dto/native-email-code-verify.dto';
import { NativeEmailCodeService } from './native-email-code.service';

/** The service answers a disabled feature while `EMAIL_CODE_ENABLED` or the application's switch is off. */
@Public()
@SkipBrowserProof()
@Controller('auth/native/attempts/:attemptId')
export class NativeEmailCodeController {
  constructor(private readonly emailCode: NativeEmailCodeService) {}

  @Post('email-code/request')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_MAGIC_LINK_REQUEST)
  async request(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeEmailRequestDto,
    @RequestLocale() locale: SupportedLocale,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.emailCode.request(attemptId, secret, body.email, locale),
    );
  }

  @Post('email-code/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_MAGIC_LINK_VERIFY)
  async verify(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeEmailCodeVerifyDto,
    @RequestLocale() locale: SupportedLocale,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.emailCode.verify(attemptId, secret, body.code, locale),
    );
  }
}
