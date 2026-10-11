import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorLoginService } from './two-factor-login.service';
import { SetupTwoFactorDto } from './dto/setup-two-factor.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequiresFeature } from '../decorators/requires-feature.decorator';
import { AuthFeature } from '../enums/auth-feature.enum';
import { RequestWithUser } from '../guards/auth.guard';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import { THROTTLE_TWO_FACTOR_VERIFY } from '../../common/constants/throttle';

/**
 * TOTP second factor.
 *
 * Four of the routes manage the factor on an account that is already signed
 * in. The fifth, verify, finishes a sign-in that was held for a code, so it
 * runs without a session and reads the challenge cookie instead.
 */
@ApiTags('auth')
@Controller('auth/2fa')
@RequiresFeature(AuthFeature.TWO_FACTOR)
export class TwoFactorController {
  constructor(
    private readonly twoFactorService: TwoFactorService,
    private readonly twoFactorLoginService: TwoFactorLoginService,
  ) {}

  /**
   * Start two-factor setup
   * POST /api/auth/2fa/setup
   */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Start two-factor setup',
    description:
      'Stores an unconfirmed secret and returns the otpauth URL to render as a ' +
      'QR code. Accounts with a password send it in the body; passwordless ' +
      'accounts need a session younger than five minutes. With password ' +
      'sign-in off, every account is treated as passwordless.',
  })
  @ApiBody({ type: SetupTwoFactorDto })
  async setup(
    @CurrentUser('id') userId: string,
    @Body() dto: SetupTwoFactorDto,
    @Req() request: RequestWithUser,
  ) {
    return this.twoFactorService.setup(userId, dto, request.session);
  }

  /**
   * Confirm the secret and turn the second factor on
   * POST /api/auth/2fa/confirm
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Confirm two-factor setup',
    description:
      'Checks a first code against the pending secret, turns the second factor ' +
      'on and returns the recovery codes. They are shown only here.',
  })
  @ApiBody({ type: TwoFactorCodeDto })
  async confirm(
    @CurrentUser('id') userId: string,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.twoFactorService.confirm(userId, dto);
  }

  /**
   * Turn the second factor off
   * POST /api/auth/2fa/disable
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Turn two-factor authentication off',
    description:
      'Needs a code or a recovery code, plus the password when the account has ' +
      'one and password sign-in is on. Clears the secret and every recovery ' +
      'code.',
  })
  @ApiBody({ type: DisableTwoFactorDto })
  async disable(
    @CurrentUser('id') userId: string,
    @Body() dto: DisableTwoFactorDto,
  ) {
    return this.twoFactorService.disable(userId, dto);
  }

  /**
   * Replace the recovery codes
   * POST /api/auth/2fa/recovery-codes/regenerate
   */
  @Post('recovery-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Replace the recovery codes',
    description:
      'Issues ten new recovery codes and drops the old batch, used or not.',
  })
  @ApiBody({ type: TwoFactorCodeDto })
  async regenerateRecoveryCodes(
    @CurrentUser('id') userId: string,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.twoFactorService.regenerateRecoveryCodes(userId, dto);
  }

  /**
   * Finish a sign-in that was held for a code
   * POST /api/auth/2fa/verify
   */
  @Public()
  @Throttle(THROTTLE_TWO_FACTOR_VERIFY)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Answer a two-factor challenge',
    description:
      'Reads the challenge cookie left by the sign-in, checks a code, a ' +
      'recovery code or a passkey, then sets the session cookie and returns ' +
      'the account. A passkey answer is fetched from ' +
      'POST /auth/passkeys/login/options first and sent as passkeyResponse; it ' +
      'has to belong to the challenged account. A passkey that did not ' +
      'verify its user is refused with PASSKEY_VERIFICATION_FAILED when the ' +
      'first step was also a passkey that did not verify its user, because ' +
      'holding one key would then answer both steps. A passkey that verified ' +
      'its user is accepted after any first step. Five wrong answers end the ' +
      'challenge.',
  })
  @ApiBody({ type: VerifyTwoFactorDto })
  async verify(
    @Body() dto: VerifyTwoFactorDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.twoFactorLoginService.verify(
      dto,
      request,
      response,
    );
    return response.status(HttpStatus.OK).json(result);
  }
}
