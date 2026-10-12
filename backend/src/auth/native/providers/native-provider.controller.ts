import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { Public } from '../../decorators/public.decorator';
import { SkipBrowserProof } from '../../decorators/skip-browser-proof.decorator';
import { NATIVE_ATTEMPT_HEADER } from '../constants/native-attempt';
import { rejectBrowserContext } from '../utils/native-request.util';
import { nativeProviderInput } from './native-provider-input';
import { NativeProviderService } from './native-provider.service';

@Public()
@SkipBrowserProof()
@Controller('auth/native/attempts/:attemptId')
export class NativeProviderController {
  constructor(private readonly provider: NativeProviderService) {}

  @Post('provider')
  async verify(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
    @Body() body: unknown,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(
      await this.provider.verify(attemptId, secret, nativeProviderInput(body)),
    );
  }
}
