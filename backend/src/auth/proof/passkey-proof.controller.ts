// feature:passkeys:start
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import { THROTTLE_PASSKEY_LOGIN } from '../../common/constants/throttle';
import { PasskeyCredentialDto } from '../passkeys/dto/passkey-credential.dto';
import { RequiresFeature } from '../decorators/requires-feature.decorator';
import { AuthFeature } from '../enums/auth-feature.enum';
import { ActingSessionOf } from './decorators/acting-session.decorator';
import { BrowserSessionGuard } from './guards/browser-session.guard';
import { PasskeyProofService } from './services/passkey-proof.service';
import type { ActingSession } from './types/acting-session';

@ApiTags('auth')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('auth/proof')
@RequiresFeature(AuthFeature.PASSKEYS)
@UseGuards(BrowserSessionGuard)
export class PasskeyProofController {
  constructor(private readonly passkeys: PasskeyProofService) {}

  @Post('options')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PASSKEY_LOGIN)
  @ApiOperation({ summary: 'Request a passkey proof with user verification' })
  @ApiOkResponse({
    description: 'WebAuthn assertion options for this account and application',
  })
  options(@ActingSessionOf() session: ActingSession) {
    return this.passkeys.options(session);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PASSKEY_LOGIN)
  @ApiOperation({ summary: 'Prove the current session with a passkey' })
  @ApiBody({ type: PasskeyCredentialDto })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { provedAt: { type: 'string', format: 'date-time' } },
      required: ['provedAt'],
    },
  })
  verify(
    @ActingSessionOf() session: ActingSession,
    @Body() dto: PasskeyCredentialDto,
  ) {
    return this.passkeys.verify(session, dto);
  }
}
// feature:passkeys:end
