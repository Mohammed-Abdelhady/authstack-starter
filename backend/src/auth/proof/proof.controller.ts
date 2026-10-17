import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import {
  THROTTLE_PROOF_CODE_REQUEST,
  THROTTLE_PROOF_CODE_VERIFY,
} from '../../common/constants/throttle';
import { ActingSessionOf } from './decorators/acting-session.decorator';
import { ProofCodeDto } from './dto/proof-code.dto';
import { EmailProofService } from './services/email-proof.service';
import type { ActingSession } from './types/acting-session';

@ApiTags('auth')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('auth/proof')
export class ProofController {
  constructor(private readonly email: EmailProofService) {}

  @Post('code')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PROOF_CODE_REQUEST)
  @ApiOperation({ summary: 'Mail a proof code to the signed-in account' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { expiresInMinutes: { type: 'number' } },
      required: ['expiresInMinutes'],
    },
  })
  send(@ActingSessionOf() session: ActingSession) {
    return this.email.send(session);
  }

  @Post('code/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_PROOF_CODE_VERIFY)
  @ApiOperation({ summary: 'Prove the current session with a mailed code' })
  @ApiBody({ type: ProofCodeDto })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { provedAt: { type: 'string', format: 'date-time' } },
      required: ['provedAt'],
    },
  })
  verify(@ActingSessionOf() session: ActingSession, @Body() dto: ProofCodeDto) {
    return this.email.verify(session, dto.code);
  }
}
