import { Request, Response } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { SecondFactorAccount } from '../stores/second-factor-account';
import { VerifyTwoFactorDto } from '../dto/verify-two-factor.dto';
import { FirstFactor } from '../../services/sessions/first-factor';

/** Multi-provider injection token holding every registered verifier. */
export const SECOND_FACTOR_VERIFIERS = 'SECOND_FACTOR_VERIFIERS';

/** The held sign-in an answer is given to. */
export interface SecondFactorAttempt {
  /** What its first step proved. */
  readonly firstFactor: FirstFactor;
}

/**
 * A way of answering a two-factor challenge that is not a code from the
 * authenticator app.
 *
 * Implementations live in the feature that owns the credential and are handed
 * to TwoFactorModule at registration, so this module never imports one. A
 * project scaffolded without that feature simply registers no verifier.
 */
export interface SecondFactorVerifier {
  /** True when the payload carries the credential this verifier checks. */
  supports(dto: VerifyTwoFactorDto): boolean;

  /** The reply a refused answer of this kind gets, the same as a wrong one. */
  refusal(): AppException;

  /**
   * @throws AppException when the credential does not answer the challenge,
   * belongs to another account, or proves nothing the first step did not
   */
  verify(
    dto: VerifyTwoFactorDto,
    user: SecondFactorAccount,
    request: Request,
    response: Response,
    attempt: SecondFactorAttempt,
  ): Promise<void>;
}
