import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  NativePasswordInput,
  NativePasskeyAssertion,
  NativeSecondFactorInput,
} from '@app/sdk';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { Public } from '../../decorators/public.decorator';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt';
import { rejectBrowserContext } from '../utils/native-request.util';
import { invalidRequest } from '../utils/native-attempt-errors';
import { NativePasswordService } from './native-password.service';
import { NativeSecondFactorService } from './native-second-factor.service';
import { NativePasskeyService } from './native-passkey.service';

@Public()
@SkipBrowserProof()
@Controller('auth/native/attempts/:attemptId')
export class NativeFactorsController {
  constructor(
    private readonly passwords: NativePasswordService,
    private readonly secondFactors: NativeSecondFactorService,
    private readonly passkeys: NativePasskeyService,
  ) {}

  @Post('password')
  async password(
    @Req() request: Request,
    @Param('attemptId') id: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativePasswordInput,
  ) {
    rejectBrowserContext(request);
    if (
      !body ||
      typeof body !== 'object' ||
      Object.keys(body).some((key) => !['email', 'password'].includes(key))
    )
      throw invalidRequest();
    return ApiResponse.success(await this.passwords.password(id, secret, body));
  }

  @Post('second-factor')
  async secondFactor(
    @Req() request: Request,
    @Param('attemptId') id: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: NativeSecondFactorInput,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.secondFactors.verify(id, secret, body),
    );
  }

  @Post('passkey/options')
  async passkeyOptions(
    @Req() request: Request,
    @Param('attemptId') id: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(await this.passkeys.options(id, secret));
  }

  @Post('passkey/verify')
  async passkeyVerify(
    @Req() request: Request,
    @Param('attemptId') id: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: { response?: NativePasskeyAssertion },
  ) {
    rejectBrowserContext(request);
    if (
      !body ||
      typeof body !== 'object' ||
      Object.keys(body).length !== 1 ||
      !body.response
    )
      throw invalidRequest();
    return ApiResponse.success(
      await this.passkeys.verify(id, secret, body.response),
    );
  }
}
