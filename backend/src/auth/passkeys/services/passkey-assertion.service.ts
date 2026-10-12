import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { PasskeyCredentialDto } from '../dto/passkey-credential.dto';
import { PasskeyChallengeService } from './passkey-challenge.service';
import { PasskeyConfigService } from './passkey-config.service';
import { PasskeyRequestOptions, WebAuthnAdapter } from './webauthn.adapter';
import {
  COUNTER_OUTCOME,
  PasskeyStore,
  StoredPasskey,
} from '../stores/passkey.store';

export interface PasskeyAssertionResult {
  passkey: StoredPasskey;
  /**
   * The authenticator asked for a PIN, a fingerprint or a face before it
   * signed. Two factors in one gesture: possession of the key and something
   * only the account holder can supply.
   */
  userVerified: boolean;
}

/**
 * Checking a signed challenge against a stored credential. Both the sign-in
 * route and the second factor route go through here, so the counter check and
 * the single-use challenge hold on either path.
 */
@Injectable()
export class PasskeyAssertionService {
  private readonly logger = new Logger(PasskeyAssertionService.name);

  constructor(
    private readonly passkeys: PasskeyStore,
    private readonly adapter: WebAuthnAdapter,
    private readonly config: PasskeyConfigService,
    private readonly challenges: PasskeyChallengeService,
  ) {}

  /**
   * Options for navigator.credentials.get(). `allowCredentials` is always
   * empty: the browser picks a discoverable credential, and an empty list is
   * also what keeps the route from confirming that an address has an account.
   */
  async createOptions(response: Response): Promise<PasskeyRequestOptions> {
    const options = await this.adapter.createAuthenticationOptions({
      rpId: this.config.rpId,
      allowCredentials: [],
    });

    await this.challenges.issue(response, 'login', options.challenge);
    return options;
  }

  /**
   * Verifies one assertion and records that the credential was used. The
   * challenge cookie is cleared either way, so a failed attempt cannot be
   * retried against the same challenge.
   *
   * @throws AppException PASSKEY_CHALLENGE_INVALID when there is no usable challenge
   * @throws AppException PASSKEY_VERIFICATION_FAILED when the credential is
   * unknown, the signature is wrong, or the counter did not move forward
   */
  async verify(
    credential: PasskeyCredentialDto,
    request: Request,
    response: Response,
  ): Promise<PasskeyAssertionResult> {
    const challenge = this.challenges.read(request, 'login');
    try {
      await this.challenges.consume('login', challenge.challenge);
    } finally {
      this.challenges.clear(response);
    }

    const passkey = await this.passkeys.findByCredentialId(credential.id);

    if (!passkey) {
      throw this.failed('credential is not registered');
    }

    const verified = await this.adapter.verifyAssertion(
      credential,
      {
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
      this.config.expectations(challenge.challenge),
    );

    if (!verified) {
      throw this.failed('signature did not verify');
    }

    this.assertCounterMovedForward(passkey.counter, verified.newCounter);

    const lastUsedAt = new Date(Date.now());
    if (passkey.counter > 0 || verified.newCounter > 0) {
      const outcome = await this.passkeys.advanceCounter(passkey, {
        counter: verified.newCounter,
        usedAt: lastUsedAt,
      });
      if (outcome !== COUNTER_OUTCOME.ADVANCED) {
        throw this.failed('counter was already advanced');
      }
    } else {
      await this.passkeys.markUsed(passkey, lastUsedAt);
    }

    return {
      passkey: { ...passkey, counter: verified.newCounter, lastUsedAt },
      userVerified: verified.userVerified,
    };
  }

  /**
   * A signature counter that repeats or goes backwards is how a cloned
   * credential shows up. Authenticators that do not count at all report zero
   * forever, and those are left alone.
   */
  private assertCounterMovedForward(stored: number, received: number): void {
    if (stored > 0 && received <= stored) {
      throw this.failed(
        `counter went from ${stored} to ${received}, credential may be cloned`,
      );
    }
  }

  private failed(reason: string): AppException {
    this.logger.warn(`Passkey assertion refused: ${reason}`);
    return new AppException(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
      'That passkey could not be used to sign in',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
