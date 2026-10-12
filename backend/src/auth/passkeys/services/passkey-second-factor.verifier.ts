import { HttpStatus, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import {
  FIRST_FACTOR,
  FirstFactor,
} from '../../services/sessions/first-factor';
import { PasskeyCredentialDto } from '../dto/passkey-credential.dto';
import { PasskeyAssertionService } from './passkey-assertion.service';

/**
 * The part of a two-factor payload this verifier reads. Declared here rather
 * than imported from the second factor, which is what lets a project ship
 * passkeys without it.
 */
export interface PasskeySecondFactorPayload {
  passkeyResponse?: PasskeyCredentialDto;
}

/** The account a challenge was opened for, as far as this verifier reads it. */
export interface ChallengedAccount {
  readonly id: string;
}

/** The held sign-in an answer is given to, as far as this verifier reads it. */
export interface ChallengedSignIn {
  /** What its first step proved. */
  readonly firstFactor: FirstFactor;
}

/**
 * A passkey as the answer to a two-factor challenge. It proves possession of a
 * key the account registered, which is what a code from the authenticator app
 * proves as well.
 *
 * A passkey that did not verify its user proves possession and nothing else.
 * After a first step that was such a passkey too, it adds no second factor:
 * whoever holds one key could answer both steps. That answer is refused,
 * whichever of the account's passkeys gives it. A passkey that verified its
 * user also proves who is holding it, and is accepted after any first step.
 *
 * TwoFactorModule picks this up through its verifier registry; nothing here
 * knows about the second factor.
 */
@Injectable()
export class PasskeySecondFactorVerifier {
  constructor(
    private readonly authFeaturesService: AuthFeaturesService,
    private readonly assertions: PasskeyAssertionService,
  ) {}

  supports(dto: PasskeySecondFactorPayload): boolean {
    return dto.passkeyResponse !== undefined;
  }

  /**
   * The credential is checked against the passkey challenge cookie the client
   * picked up from POST /auth/passkeys/login/options, and has to belong to the
   * account the two-factor challenge was issued for.
   *
   * @throws AppException FEATURE_DISABLED when the deployment turned passkeys off
   * @throws AppException PASSKEY_VERIFICATION_FAILED when the credential
   * belongs to another account, or did not verify its user after a first step
   * that was a passkey
   */
  async verify(
    dto: PasskeySecondFactorPayload,
    user: ChallengedAccount,
    request: Request,
    response: Response,
    signIn: ChallengedSignIn,
  ): Promise<void> {
    this.authFeaturesService.assertEnabled(AuthFeature.PASSKEYS);

    if (!dto.passkeyResponse) {
      throw this.refused();
    }

    const { passkey, userVerified } = await this.assertions.verify(
      dto.passkeyResponse,
      request,
      response,
    );

    if (passkey.userId !== user.id) {
      throw this.refused();
    }

    if (!userVerified && signIn.firstFactor === FIRST_FACTOR.PASSKEY) {
      throw this.refused();
    }
  }

  private refused(): AppException {
    return new AppException(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
      'That passkey could not be used to sign in',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
