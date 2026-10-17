// feature:passkeys:start
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { THROTTLE_PASSKEY_LOGIN } from '../../common/constants/throttle';
import { RequiresFeature } from '../decorators/requires-feature.decorator';
import { AuthFeature } from '../enums/auth-feature.enum';
import { PasskeyCredentialDto } from '../passkeys/dto/passkey-credential.dto';
import { ActingSessionOf } from './decorators/acting-session.decorator';
import { NativeProofSessionGuard } from './guards/native-proof-session.guard';
import { PasskeyProofService } from './services/passkey-proof.service';
import type { ActingSession } from './types/acting-session';

@Controller('auth/native/proof')
@RequiresFeature(AuthFeature.PASSKEYS)
@UseGuards(NativeProofSessionGuard)
export class NativePasskeyProofController {
  constructor(private readonly proofs: PasskeyProofService) {}

  @Post('options')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PASSKEY_LOGIN)
  async options(@ActingSessionOf() session: ActingSession) {
    const { challenge, timeout, rpId, allowCredentials } =
      await this.proofs.options(session);
    return ApiResponse.success({
      challenge,
      timeout,
      rpId,
      allowCredentials,
      userVerification: 'required' as const,
    });
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PASSKEY_LOGIN)
  async verify(
    @ActingSessionOf() session: ActingSession,
    @Body() credential: PasskeyCredentialDto,
  ) {
    return ApiResponse.success(await this.proofs.verify(session, credential));
  }
}
// feature:passkeys:end
