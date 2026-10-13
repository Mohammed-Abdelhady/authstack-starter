import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { ResetPasswordResponseDto } from './dto/reset-password-response.dto';
import { ApiResponse } from '../common/dto/api-response.dto';
import { HashService } from '../common/services/hash.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/enums/error-code.enum';
import { AuthMailService } from './services/mail/auth-mail.service';
import { Sessions } from './services/sessions/sessions';
import { PasswordResetCodeService } from './services/codes/password-reset-code.service';
import type { IssuedCodeWithGeneration } from './interfaces/pending-code.interface';
import { MailCounterService } from './services/mail/mail-counter.service';
import { FIRST_FACTOR } from './services/sessions/first-factor'; // feature:totp
import { SignInCompletion } from './services/sessions/sign-in-completion';
import { IdFormat } from '../common/persistence/id-format';
import { assertValidId } from '../user/utils/user-lookup.util';
import { PasswordSignInStore } from './stores/password-sign-in.store';
import { generateVerificationCode } from './utils/verification-code.util';
import { MAIL_COUNTER_PURPOSE } from './constants/registration';
import { SecurityNoticeService } from '../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../user/constants/security-notice.constants';
import { verifyPasswordCredentials } from './services/password/password-credentials';

/**
 * Password sign-in and the password lifecycle. The sign-up code flows live in
 * RegistrationService; this service keeps the routes that already have an
 * account to work with.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accounts: PasswordSignInStore,
    private readonly ids: IdFormat,
    private readonly hashService: HashService,
    private readonly authMailService: AuthMailService,
    private readonly sessionService: Sessions,
    private readonly passwordResetCodeService: PasswordResetCodeService,
    private readonly mailCounterService: MailCounterService,
    private readonly signInService: SignInCompletion,
    private readonly notices?: SecurityNoticeService,
  ) {}

  async login(
    dto: LoginDto,
    response: Response,
  ): Promise<ApiResponse<LoginResponseDto>> {
    const user = await verifyPasswordCredentials(
      this.accounts,
      this.hashService,
      dto,
    );
    const outcome = await this.signInService.completeSignIn(
      user,
      response,
      FIRST_FACTOR.PASSWORD, // feature:totp
    );

    if (outcome.requiresTwoFactor) {
      this.logger.log(
        `Password accepted, second factor owed: userId=${user.id}`,
      );
      return LoginResponseDto.twoFactorRequired();
    }

    this.logger.log(`User logged in: userId=${user.id}`);
    return LoginResponseDto.success(outcome.user);
  }

  async logout(
    sessionToken: string,
  ): Promise<ApiResponse<{ message: string }>> {
    const invalidated =
      await this.sessionService.invalidateSession(sessionToken);

    if (!invalidated) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Invalid session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('User logged out successfully');
    return ApiResponse.success({ message: 'Logout successful' });
  }

  async logoutNative(
    sessionId: string,
    userId: string,
  ): Promise<ApiResponse<{ message: string }>> {
    assertValidId(this.ids, userId, 'Invalid user ID format');
    assertValidId(this.ids, sessionId, 'Invalid session ID format');

    const invalidated = await this.sessionService.invalidateNativeSession(
      userId,
      sessionId,
    );

    if (!invalidated) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Invalid session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('User logged out successfully');
    return ApiResponse.success({ message: 'Logout successful' });
  }

  /**
   * Mail a password reset code. An address without an account gets the same
   * reply as one with an account, and no mail.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ApiResponse<ForgotPasswordResponseDto>> {
    await this.issuePasswordReset(dto.email);
    return ForgotPasswordResponseDto.success(dto.email);
  }

  /** Same generic request path with a generation commitment for native use. */
  async forgotPasswordForNative(email: string): Promise<string | null> {
    const candidate = await this.accounts.findForPasswordCheck(email);
    if (!candidate?.passwordHash) {
      await this.spendCodeHashingTime();
      return null;
    }
    const issued = await this.issuePasswordReset(email);
    return issued?.generationHash ?? null;
  }

  private async issuePasswordReset(
    email: string,
  ): Promise<IssuedCodeWithGeneration | null> {
    const user = await this.accounts.findActiveByAddress(email);

    if (!user) {
      await this.spendCodeHashingTime();
      return null;
    }

    const underCap = await this.mailCounterService.tryRecord(
      email,
      MAIL_COUNTER_PURPOSE.PASSWORD_RESET,
    );
    if (!underCap) {
      // Same reply and the same bcrypt cost as an uncapped request, so the cap
      // cannot be told apart from a missing account.
      await this.spendCodeHashingTime();
      return null;
    }

    const issued =
      await this.passwordResetCodeService.createOrUpdatePasswordResetWithGeneration(
        email,
      );

    this.authMailService.deferPasswordResetCode(email, issued.code, user.name);

    return issued;
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<ApiResponse<ResetPasswordResponseDto>> {
    const reserved = await this.passwordResetCodeService.verifyPasswordReset(
      dto.email,
      dto.code,
    );

    const consumed = await this.passwordResetCodeService.consumePasswordReset(
      reserved.id,
      reserved.hashedCode,
    );
    if (!consumed) {
      throw this.passwordResetCodeService.invalidCode();
    }

    const user = await this.accounts.findActiveByAddress(dto.email);
    if (!user) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND_FOR_RESET,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const hashedPassword = await this.hashService.hash(dto.newPassword);
    await this.accounts.storeNewPassword(user, hashedPassword);

    await this.sessionService.invalidateAllSessions(user.id);
    this.notices?.defer(user.id, SECURITY_NOTICE.PASSWORD_RESET);
    this.logger.log(`Password reset successful: userId=${user.id}`);

    return ResetPasswordResponseDto.success();
  }

  /**
   * Spend the bcrypt time a real code would have cost.
   * Requests for addresses without an account take as long as requests for
   * addresses with one.
   */
  private async spendCodeHashingTime(): Promise<void> {
    await this.hashService.hash(generateVerificationCode());
  }
}
