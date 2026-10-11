import {
  Get,
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiCookieAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RegistrationService } from './services/registration/registration.service';
import { EmailChangeConfirmationService } from './services/registration/email-change-confirmation.service';
import { RegisterDto } from './dto/register.dto';
import { ActivateDto } from './dto/activate.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendActivationDto } from './dto/resend-activation.dto';
import { Public } from './decorators/public.decorator';
import { RequiresFeature } from './decorators/requires-feature.decorator';
import { AuthFeature } from './enums/auth-feature.enum';
import { Throttle } from '@nestjs/throttler';
import { SessionCookieService } from './services/sessions/session-cookie.service';
import { BrowserProofService } from '../session/services/browser-proof.service';
import { CSRF_HEADER } from '../session/constants/browser-proof';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/enums/error-code.enum';
import { RequestWithUser } from './guards/auth.guard';
import { SESSION_SWAGGER_AUTH_NAME } from '../common/constants/session';
import { CREDENTIAL_PURPOSE } from '../session/constants/credential-purpose';
import {
  THROTTLE_LOGIN,
  THROTTLE_FORGOT_PASSWORD,
  THROTTLE_RESET_PASSWORD,
  THROTTLE_ACTIVATE,
  THROTTLE_REGISTER,
} from '../common/constants/throttle';

/**
 * Password sign-in and the account lifecycle around it.
 *
 * Six routes close with AUTH_PASSWORD_ENABLED=false: register, activate,
 * resend-activation, login, forgot-password and reset-password. Activation
 * sets a password, so it closes with the rest. Logout stays open, and so does
 * confirm-email-change: it confirms an address an admin moved an account to,
 * which has nothing to do with passwords.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
    private readonly emailChangeConfirmationService: EmailChangeConfirmationService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly browserProof: BrowserProofService,
  ) {}

  @Public()
  @Get('browser-proof')
  @ApiOperation({
    summary: 'Issue a short-lived browser proof',
    description:
      'Sets the proof cookie and returns the header secret for login, registration, and other requests that do not have a session yet.',
  })
  async issueBrowserProof(@Res({ passthrough: true }) response: Response) {
    const token = await this.browserProof.issue(response);
    response.setHeader(CSRF_HEADER, token);
    return { success: true, data: { token } };
  }

  @Get('csrf')
  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Read the session browser proof',
    description:
      'Returns the CSRF secret for the current session so a reloaded page can keep it in memory.',
  })
  csrf(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.session?.csrfToken;
    if (!token) {
      throw new AppException(
        ErrorCode.CSRF_INVALID,
        'Browser proof is invalid',
        HttpStatus.FORBIDDEN,
      );
    }
    response.setHeader(CSRF_HEADER, token);
    return { success: true, data: { token } };
  }

  /**
   * Register a new user
   * POST /api/auth/register
   */
  @Public()
  @RequiresFeature(AuthFeature.PASSWORD)
  @Throttle(THROTTLE_REGISTER)
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Starts a sign-up with the email address only and mails a 6-digit ' +
      'activation code. The password and name are supplied at activation. A ' +
      'body that still carries a password or a name is refused with ' +
      'REGISTRATION_CONTRACT_OUTDATED.',
  })
  @ApiBody({ type: RegisterDto })
  async register(@Body() dto: RegisterDto) {
    return this.registrationService.register(dto);
  }

  /**
   * Activate account with email and code
   * POST /api/auth/activate
   */
  @Public()
  @RequiresFeature(AuthFeature.PASSWORD)
  @Throttle(THROTTLE_ACTIVATE)
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate user account',
    description:
      'Activates a user account with the email address, the 6-digit code ' +
      'mailed during registration, and the password and name chosen here. ' +
      'The address must not already have an account.',
  })
  @ApiBody({ type: ActivateDto })
  async activate(@Body() dto: ActivateDto, @Res() response: Response) {
    const result = await this.registrationService.activate(dto, response);
    return response.status(HttpStatus.OK).json(result);
  }

  /**
   * Confirm the new address an admin moved an account to
   * POST /auth/confirm-email-change
   */
  @Public()
  @Throttle(THROTTLE_ACTIVATE)
  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an admin-initiated email change',
    description:
      'Marks the new address verified on the account an admin moved. It needs ' +
      'no password and issues no session, so a deployment without password ' +
      'sign-in still confirms addresses.',
  })
  @ApiBody({ type: ConfirmEmailChangeDto })
  async confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.emailChangeConfirmationService.confirm(dto);
  }

  /**
   * Resend activation code
   * POST /api/auth/resend-activation
   */
  @Public()
  @RequiresFeature(AuthFeature.PASSWORD)
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @Post('resend-activation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend activation code',
    description:
      'Sends a new 6-digit activation code to the provided email address. ' +
      'Rate limited to 3 requests per hour per client IP.',
  })
  @ApiBody({ type: ResendActivationDto })
  async resendActivation(@Body() dto: ResendActivationDto) {
    return this.registrationService.resendActivation(dto);
  }

  /**
   * Login user with email and password
   * POST /api/auth/login
   */
  @Public()
  @RequiresFeature(AuthFeature.PASSWORD)
  @Throttle(THROTTLE_LOGIN)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login user',
    description:
      'Authenticates a user with email and password. ' +
      'Sets the session cookie upon successful authentication.',
  })
  @ApiBody({ type: LoginDto })
  async login(@Body() dto: LoginDto, @Res() response: Response) {
    const result = await this.authService.login(dto, response);
    return response.status(HttpStatus.OK).json(result);
  }

  /**
   * Logout user by invalidating session
   * POST /api/auth/logout
   * Requires authentication
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
  @ApiOperation({
    summary: 'Logout user',
    description:
      'Invalidates current user session and clears session cookie. ' +
      'Requires the session cookie.',
  })
  async logout(@Req() request: RequestWithUser, @Res() response: Response) {
    const session = request.session;
    if (
      session?.credentialPurpose === CREDENTIAL_PURPOSE.NATIVE_ACCESS &&
      request.user
    ) {
      const result = await this.authService.logoutNative(
        session.id,
        request.user.id,
      );
      return response.status(HttpStatus.OK).json(result);
    }

    const result = await this.authService.logout(
      this.sessionCookieService.read(request) ?? '',
    );
    this.sessionCookieService.clear(response);

    return response.status(HttpStatus.OK).json(result);
  }

  /**
   * Request password reset code
   * POST /api/auth/forgot-password
   */
  @Public()
  @RequiresFeature(AuthFeature.PASSWORD)
  @Throttle(THROTTLE_FORGOT_PASSWORD)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Sends a 6-digit password reset code to the user email address. ' +
      'The code expires in 15 minutes.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /**
   * Reset password with email and code
   * POST /api/auth/reset-password
   */
  @Public()
  @RequiresFeature(AuthFeature.PASSWORD)
  @Throttle(THROTTLE_RESET_PASSWORD)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password',
    description:
      'Resets user password using email address and 6-digit reset code. ' +
      'The code must be valid and not expired.',
  })
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
