import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { PasskeyRegistrationOptionsDto } from '../dto/passkey-registration-options.dto';
import { PasskeySummaryDto } from '../dto/passkey-summary.dto';
import { VerifyPasskeyRegistrationDto } from '../dto/verify-passkey-registration.dto';
import { toPasskeySummary } from '../utils/passkey-summary.util';
import {
  BrowserPasskeyCeremony,
  BrowserPasskeyPolicy,
} from './browser-passkey-policy.service';
import { PasskeyChallengeService } from './passkey-challenge.service';
import { PasskeyConfigService } from './passkey-config.service';
import { PasskeyRegistrationReauth } from './passkey-registration-reauth.service';
import { PasskeyRecorder } from './passkey-recorder.service';
import { PasskeyCreationOptions, WebAuthnAdapter } from './webauthn.adapter';
import {
  PASSKEY_CEREMONY,
  PASSKEY_DEFAULT_NAME,
  UserVerificationRequirement,
} from '../constants/passkeys.constants';
import { PasskeyAccounts } from '../stores/passkey-accounts';
import { PasskeyStore } from '../stores/passkey.store';
import { SecurityNoticeService } from '../../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../../user/constants/security-notice.constants';
import { relyingPartyScope } from '../utils/relying-party.util';
import { registrationUserVerification } from '../utils/registration-user-verification.util';
import {
  isNativeSession,
  RegisteringSession,
  wrongCredentialKind,
} from '../utils/session-kind.util';

/** A request as the guard left it. The session it arrived on is all that is read. */
export type SignedInRequest = Request & {
  session?: RegisteringSession;
};

/**
 * Adding a passkey to an account that is already signed in. The challenge the
 * authenticator signs over is handed out by the options route and checked by
 * the verify route, so a response captured elsewhere cannot be replayed here.
 *
 * The options route hands a challenge out only to a caller that proved itself
 * again, and the challenge names the session that did. The verify route takes
 * a challenge from that session and no other, so the two routes cannot be
 * called under different conditions.
 *
 * The passkey belongs to the relying party of the session's application.
 */
@Injectable()
export class PasskeyRegistrationService {
  private readonly logger = new Logger(PasskeyRegistrationService.name);

  constructor(
    private readonly passkeys: PasskeyStore,
    private readonly accounts: PasskeyAccounts,
    private readonly adapter: WebAuthnAdapter,
    private readonly config: PasskeyConfigService,
    private readonly challenges: PasskeyChallengeService,
    private readonly reauth: PasskeyRegistrationReauth,
    private readonly recorder: PasskeyRecorder,
    private readonly policy: BrowserPasskeyPolicy,
    private readonly notices?: SecurityNoticeService,
  ) {}

  /**
   * Options for navigator.credentials.create(). Credentials the account
   * already has for the application's relying party are excluded, so an
   * authenticator that holds one says so instead of registering a second.
   *
   * @throws AppException FORBIDDEN for a mobile access token, which registers
   * through the native routes
   * @throws AppException REAUTH_REQUIRED, INVALID_CURRENT_PASSWORD,
   * TWO_FACTOR_CODE_INVALID or TWO_FACTOR_LOCKED when the caller did not prove
   * itself again
   */
  async createOptions(
    userId: string,
    proof: PasskeyRegistrationOptionsDto,
    request: SignedInRequest,
    response: Response,
  ): Promise<ApiResponse<PasskeyCreationOptions>> {
    if (isNativeSession(request.session)) throw wrongCredentialKind();
    const user = await this.accounts.findAccount(userId);

    if (!user || user.isDeleted) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.reauth.assertMayAddPasskey(user.id, proof, request.session);

    const ceremony = await this.policy.of(request);
    const existing = await this.passkeys.listDescriptorsFor(
      user.id,
      relyingPartyScope(ceremony.relyingParty.rpId, this.config.rpId),
    );

    const options = await this.adapter.createRegistrationOptions({
      rpId: ceremony.relyingParty.rpId,
      rpName: this.config.rpName,
      userId: user.id,
      userName: user.email,
      userDisplayName: user.name,
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports,
      })),
      userVerification: userVerificationFor(ceremony),
    });

    await this.challenges.issue(
      response,
      'register',
      options.challenge,
      user.id,
      request.session?.id,
    );

    return ApiResponse.success(options);
  }

  /**
   * @throws AppException PASSKEY_CHALLENGE_INVALID when the cookie belongs to
   * another account, another ceremony, another application, or a session
   * other than the one that proved itself for it
   * @throws AppException PASSKEY_VERIFICATION_FAILED when the attestation does
   * not check out, or the credential is already registered
   */
  async verify(
    userId: string,
    dto: VerifyPasskeyRegistrationDto,
    request: SignedInRequest,
    response: Response,
  ): Promise<ApiResponse<PasskeySummaryDto>> {
    if (isNativeSession(request.session)) throw wrongCredentialKind();
    const challenge = await this.challenges.read(request, 'register');
    try {
      await this.challenges.consume('register', challenge.challenge);
    } finally {
      this.challenges.clear(response);
    }

    const session = request.session;
    if (
      challenge.sub !== userId ||
      session === undefined ||
      challenge.sid !== session.id
    ) {
      throw new AppException(
        ErrorCode.PASSKEY_CHALLENGE_INVALID,
        'This passkey attempt is no longer valid. Start again.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const ceremony = await this.policy.of(request);
    const verified = await this.adapter.verifyAttestation(dto.response, {
      challenge: challenge.challenge,
      origins: ceremony.relyingParty.origins,
      rpId: ceremony.relyingParty.rpId,
      userVerification: userVerificationFor(ceremony),
    });

    if (!verified) {
      throw this.verificationFailed('attestation did not verify');
    }

    if (await this.passkeys.isCredentialRegistered(verified.credentialId)) {
      throw this.verificationFailed('credential is already registered');
    }

    const passkey = await this.recorder.record(
      {
        userId,
        rpId: ceremony.relyingParty.rpId,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
        name: dto.name?.trim() || PASSKEY_DEFAULT_NAME,
      },
      {
        sessionId: session.id,
        clientId: session.clientId,
        userVerified: verified.userVerified,
      },
    );

    this.logger.log(`Passkey registered for user ${userId}`);
    this.notices?.defer(userId, SECURITY_NOTICE.PASSKEY_ADDED);
    return ApiResponse.success(toPasskeySummary(passkey), 'Passkey added');
  }

  private verificationFailed(reason: string): AppException {
    this.logger.warn(`Passkey registration refused: ${reason}`);
    return new AppException(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
      'That passkey could not be registered',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * A browser registration verifies its user where the application lets its
 * users in with a passkey only. Otherwise it is asked for, not required, as
 * before.
 */
function userVerificationFor(
  ceremony: BrowserPasskeyCeremony,
): UserVerificationRequirement {
  return registrationUserVerification({
    ceremony: PASSKEY_CEREMONY.BROWSER,
    requirePasskey: ceremony.requirePasskey,
    enrolment: false,
  });
}
