import { Controller } from '@nestjs/common';
import { Body, Headers, Param, Post, Req } from '@nestjs/common'; // feature:email-password,totp,passkeys
import type { Request } from 'express'; // feature:email-password,totp,passkeys
import type { NativePasswordInput } from '@app/sdk'; // feature:email-password
import type { NativeSecondFactorInput } from '@app/sdk'; // feature:totp
import type { NativePasskeyAssertion } from '@app/sdk'; // feature:passkeys
import { ApiResponse } from '../../../common/dto/api-response.dto'; // feature:email-password,totp,passkeys
import { Public } from '../../decorators/public.decorator';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt'; // feature:email-password,totp,passkeys
import { rejectBrowserContext } from '../utils/native-request.util'; // feature:email-password,totp,passkeys
import { invalidRequest } from '../utils/native-attempt-errors'; // feature:email-password,passkeys
import { NativePasswordService } from './native-password.service'; // feature:email-password
import { NativeSecondFactorService } from './native-second-factor.service'; // feature:totp
import { NativePasskeyService } from './native-passkey.service'; // feature:passkeys

@Public()
@SkipBrowserProof()
@Controller('auth/native/attempts/:attemptId')
export class NativeFactorsController {
  constructor(
    private readonly passwords: NativePasswordService, // feature:email-password
    private readonly secondFactors: NativeSecondFactorService, // feature:totp
    private readonly passkeys: NativePasskeyService, // feature:passkeys
  ) {}

  // feature:email-password:start
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
  // feature:email-password:end

  // feature:totp:start
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
  // feature:totp:end

  // feature:passkeys:start
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
  // feature:passkeys:end
}
