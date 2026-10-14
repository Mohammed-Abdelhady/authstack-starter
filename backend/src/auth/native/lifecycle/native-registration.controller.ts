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
  THROTTLE_ACTIVATE,
  THROTTLE_REGISTER,
} from '../../../common/constants/throttle';
import { ActivateDto } from '../../dto/activate.dto';
import { Public } from '../../decorators/public.decorator';
import { RequiresFeature } from '../../decorators/requires-feature.decorator';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt';
import { rejectBrowserContext } from '../utils/native-request.util';
import { NativeEmailRequestDto } from './dto/native-email-request.dto';
import { RequestLocale } from '../../../common/decorators/request-locale.decorator';
import type { SupportedLocale } from '../../../common/constants/locales';
import { NativeRegistrationService } from './native-registration.service'; // feature:email-password

@Public()
@SkipBrowserProof()
@RequiresFeature(AuthFeature.PASSWORD)
@Controller('auth/native/attempts/:attemptId')
export class NativeRegistrationController {
  constructor(private readonly registration: NativeRegistrationService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_REGISTER)
  async register(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeEmailRequestDto,
    @RequestLocale() locale: SupportedLocale,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.registration.request(attemptId, secret, body.email, locale),
    );
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_ACTIVATE)
  async activate(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: ActivateDto,
    @RequestLocale() locale: SupportedLocale,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.registration.activate(attemptId, secret, { ...body, locale }),
    );
  }
}
