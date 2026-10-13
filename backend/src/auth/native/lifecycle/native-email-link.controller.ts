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
import { Public } from '../../decorators/public.decorator';
import { RequiresFeature } from '../../decorators/requires-feature.decorator';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt';
import { rejectBrowserContext } from '../utils/native-request.util';
import { NativeEmailRequestDto } from './dto/native-email-request.dto';
import { NativeEmailLinkVerifyDto } from './dto/native-email-link-verify.dto';
import { NativeEmailLinkService } from './native-email-link.service'; // feature:magic-link

@Public()
@SkipBrowserProof()
@RequiresFeature(AuthFeature.MAGIC_LINK)
@Controller('auth/native/attempts/:attemptId')
export class NativeEmailLinkController {
  constructor(private readonly emailLink: NativeEmailLinkService) {}

  @Post('email-link/request')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_MAGIC_LINK_REQUEST)
  async request(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeEmailRequestDto,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.emailLink.request(attemptId, secret, body.email),
    );
  }

  @Post('email-link/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_MAGIC_LINK_VERIFY)
  async verify(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeEmailLinkVerifyDto,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.emailLink.verify(attemptId, secret, body),
    );
  }
}
