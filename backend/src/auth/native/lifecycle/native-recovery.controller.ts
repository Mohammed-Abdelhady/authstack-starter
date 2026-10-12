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
  THROTTLE_FORGOT_PASSWORD,
  THROTTLE_RESET_PASSWORD,
} from '../../../common/constants/throttle';
import { ResetPasswordDto } from '../../dto/reset-password.dto';
import { Public } from '../../decorators/public.decorator';
import { RequiresFeature } from '../../decorators/requires-feature.decorator';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt';
import { rejectBrowserContext } from '../utils/native-request.util';
import { NativeEmailRequestDto } from './dto/native-email-request.dto';
import { NativeRecoveryService } from './native-recovery.service'; // feature:email-password

@Public()
@SkipBrowserProof()
@RequiresFeature(AuthFeature.PASSWORD)
@Controller('auth/native/attempts/:attemptId')
export class NativeRecoveryController {
  constructor(private readonly recovery: NativeRecoveryService) {}

  @Post('recovery/request')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_FORGOT_PASSWORD)
  async request(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeEmailRequestDto,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.recovery.request(attemptId, secret, body.email),
    );
  }

  @Post('recovery/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_RESET_PASSWORD)
  async confirm(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: ResetPasswordDto,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.recovery.confirm(attemptId, secret, body),
    );
  }
}
