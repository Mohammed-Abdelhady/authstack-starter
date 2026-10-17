import { AudienceAdmissionRefused } from '../../session/utils/authority/audience-admission';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { SECOND_FACTOR_AUTHENTICATION_METHOD } from './constants/two-factor.constants';
import { Request, Response } from 'express';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { LoginResponseDto } from '../dto/login-response.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';
import { TwoFactorVerificationService } from './services/two-factor-verification.service';
import {
  SECOND_FACTOR_VERIFIERS,
  SecondFactorAttempt,
  SecondFactorVerifier,
} from './services/second-factor-verifiers';
import { SecondFactorAccount } from './stores/second-factor-account';
import { SecondFactorSignIn } from './stores/second-factor-sign-in';
import { SecondFactorStore } from './stores/second-factor.store';

/**
 * The second half of a sign-in that was held for a code. The first half left a
 * challenge cookie; this turns a correct answer into the session it was owed.
 *
 * The answer is a TOTP code, a recovery code, or whatever a registered second
 * factor verifier accepts. A passkey is one of those: it proves possession of
 * a key the account registered, which is what a code from the app proves. A
 * verifier is told what the first step proved, so it can refuse an answer
 * that proves the same thing again.
 */
@Injectable()
export class TwoFactorLoginService {
  private readonly logger = new Logger(TwoFactorLoginService.name);

  constructor(
    private readonly accounts: SecondFactorStore,
    private readonly challengeService: TwoFactorChallengeService,
    private readonly verificationService: TwoFactorVerificationService,
    private readonly signIn: SecondFactorSignIn,
    @Inject(SECOND_FACTOR_VERIFIERS)
    private readonly verifiers: SecondFactorVerifier[],
    private readonly applications: BrowserApplications,
  ) {}

  /**
   * @throws AppException TWO_FACTOR_CHALLENGE_INVALID when there is no usable
   * challenge behind the cookie
   * @throws AppException TWO_FACTOR_CODE_INVALID when the code is wrong, after
   * counting the try against the challenge
   */
  async verify(
    dto: VerifyTwoFactorDto,
    request: Request,
    response: Response,
  ): Promise<ApiResponse<LoginResponseDto>> {
    const challenge = await this.challengeService.claim(request);
    const user = await this.accounts.findChallengedAccount(challenge.userId);

    if (!user || user.isDeleted || !user.twoFactor.enabled) {
      await this.discard(challenge.challengeId, response);
      throw new AppException(
        ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
        'This sign-in attempt is no longer valid. Start again.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const verifier = this.verifiers.find((candidate) =>
      candidate.supports(dto),
    );
    let secondFactor: string | null;
    try {
      await this.signIn.assertAdmission(user.id, response);
      secondFactor = await this.checkSecondFactor(
        verifier,
        dto,
        user,
        request,
        response,
        {
          firstFactor: challenge.firstFactor,
        },
      );
    } catch (error) {
      await this.challengeService.registerFailure(challenge.challengeId);
      this.rethrowAdmission(error, verifier);
    }

    const evidence = this.applications.evidenceFor(request);
    this.applications.rememberEvidence(request, {
      authenticationMethods: [
        ...new Set([
          challenge.firstFactor,
          ...(evidence?.authenticationMethods ?? []),
          ...(secondFactor ? [secondFactor] : []),
        ]),
      ],
      userVerified: evidence?.userVerified ?? false,
    });
    await this.discard(challenge.challengeId, response);
    const summary = await this.signIn
      .issueSession(user, response)
      .catch((error: unknown) => this.rethrowAdmission(error, verifier));

    this.logger.log(`Second factor accepted: userId=${user.id}`);
    return LoginResponseDto.success(summary);
  }

  /**
   * A code goes to the verification service. Anything else is a credential a
   * registered verifier owns, such as a passkey.
   */
  private async checkSecondFactor(
    verifier: SecondFactorVerifier | undefined,
    dto: VerifyTwoFactorDto,
    user: SecondFactorAccount,
    request: Request,
    response: Response,
    attempt: SecondFactorAttempt,
  ): Promise<string | null> {
    if (!verifier) {
      await this.verificationService.verifySecondFactor(user, dto);
      if (dto.code) return SECOND_FACTOR_AUTHENTICATION_METHOD.TOTP;
      return dto.recoveryCode
        ? SECOND_FACTOR_AUTHENTICATION_METHOD.RECOVERY_CODE
        : null;
    }

    await verifier.verify(dto, user, request, response, attempt);
    return null;
  }

  private rethrowAdmission(
    error: unknown,
    verifier: SecondFactorVerifier | undefined,
  ): never {
    if (error instanceof AudienceAdmissionRefused) {
      throw verifier
        ? verifier.refusal()
        : this.verificationService.invalidCode('account audience refused');
    }
    throw error;
  }

  private async discard(
    challengeId: string,
    response: Response,
  ): Promise<void> {
    await this.challengeService.consume(challengeId);
    this.challengeService.clear(response);
  }
}
