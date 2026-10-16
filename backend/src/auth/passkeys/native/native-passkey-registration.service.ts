import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { Clock } from '../../../common/services/clock';
import { SecurityNoticeService } from '../../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../../user/constants/security-notice.constants';
import { assertRecentSignIn } from '../../services/reauth/reauth.service';
import {
  PASSKEY_CEREMONY,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_DEFAULT_NAME,
  NATIVE_REGISTRATION_POLICY,
  UserVerificationRequirement,
} from '../constants/passkeys.constants';
import { PasskeySummaryDto } from '../dto/passkey-summary.dto';
import { VerifyPasskeyRegistrationDto } from '../dto/verify-passkey-registration.dto';
import { PasskeyConfigService } from '../services/passkey-config.service';
import { PasskeyRecorder } from '../services/passkey-recorder.service';
import {
  PasskeyCreationOptions,
  WebAuthnAdapter,
} from '../services/webauthn.adapter';
import { PasskeyAccounts } from '../stores/passkey-accounts';
import {
  CHALLENGE_USE,
  PasskeyChallengeStore,
} from '../stores/passkey-challenge.store';
import { PasskeyStore } from '../stores/passkey.store';
import { toPasskeySummary } from '../utils/passkey-summary.util';
import { relyingPartyScope } from '../utils/relying-party.util';
import { registrationUserVerification } from '../utils/registration-user-verification.util';
import {
  isNativeSession,
  RegisteringSession,
  wrongCredentialKind,
} from '../utils/session-kind.util';
import {
  NativeRelyingParties,
  PasskeyRelyingParty,
} from './native-relying-parties';
import {
  ChallengeBinding,
  matchesDigest,
  registrationDigest,
  signedChallengeOf,
} from './native-registration-challenge';

/** A mobile session as the guard left it. */
export interface NativeRegisteringSession extends RegisteringSession {
  /** When the sign-in happened, by the clock that issued the session. */
  authenticatedAt: Date;
}

/**
 * Adding a passkey from a signed-in mobile app. No cookie carries the
 * challenge: a digest of it, bound to the session, the account and the
 * application's relying party, is stored and spent once by the verify route.
 */
@Injectable()
export class NativePasskeyRegistrationService {
  private readonly logger = new Logger(NativePasskeyRegistrationService.name);

  constructor(
    private readonly passkeys: PasskeyStore,
    private readonly accounts: PasskeyAccounts,
    private readonly adapter: WebAuthnAdapter,
    private readonly config: PasskeyConfigService,
    private readonly challenges: PasskeyChallengeStore,
    private readonly relyingParties: NativeRelyingParties,
    private readonly recorder: PasskeyRecorder,
    private readonly clock: Clock,
    private readonly notices?: SecurityNoticeService,
  ) {}

  /**
   * Options for the system passkey prompt, for the application's relying
   * party. The account's passkeys for that relying party are excluded.
   *
   * @throws AppException FORBIDDEN for a browser session
   * @throws AppException FEATURE_DISABLED when the application makes none
   * @throws AppException REAUTH_REQUIRED when the sign-in is over five
   * minutes old, with `details.required` recent_sign_in
   */
  async createOptions(
    userId: string,
    session: NativeRegisteringSession | undefined,
  ): Promise<ApiResponse<PasskeyCreationOptions>> {
    const signedIn = this.nativeSessionOf(session);
    const relyingParty = this.relyingPartyOf(signedIn);
    const user = await this.accounts.findAccount(userId);
    if (!user || user.isDeleted) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const now = this.clock.now();
    assertRecentSignIn(
      signedIn.authenticatedAt,
      now,
      'Sign in again to add a passkey',
    );

    const existing = await this.passkeys.listDescriptorsFor(
      user.id,
      relyingPartyScope(relyingParty.rpId, this.config.rpId),
    );
    const options = await this.adapter.createRegistrationOptions({
      rpId: relyingParty.rpId,
      rpName: this.config.rpName,
      userId: user.id,
      userName: user.email,
      userDisplayName: user.name,
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports,
      })),
      userVerification: this.userVerification(),
    });
    const binding: ChallengeBinding = {
      sessionId: signedIn.id,
      userId: user.id,
      rpId: relyingParty.rpId,
    };
    await this.challenges.open({
      challengeHash: registrationDigest(binding, options.challenge),
      purpose: 'nativeRegister',
      userId: user.id,
      sessionId: signedIn.id,
      expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
    });
    return ApiResponse.success(options);
  }

  /**
   * @throws AppException PASSKEY_CHALLENGE_INVALID when the client data names
   * no readable challenge, or the challenge is unknown, spent, lapsed, or was
   * handed to another session or account
   * @throws AppException PASSKEY_VERIFICATION_FAILED when the attestation does
   * not check out, the credential is stored already, or the account is gone
   */
  async verify(
    userId: string,
    session: NativeRegisteringSession | undefined,
    dto: VerifyPasskeyRegistrationDto,
  ): Promise<ApiResponse<PasskeySummaryDto>> {
    const signedIn = this.nativeSessionOf(session);
    const relyingParty = this.relyingPartyOf(signedIn);
    const challenge = signedChallengeOf(dto.response);
    if (challenge === null) {
      throw this.challengeInvalid('client data names no challenge');
    }
    const binding: ChallengeBinding = {
      sessionId: signedIn.id,
      userId,
      rpId: relyingParty.rpId,
    };
    const expected = registrationDigest(binding, challenge);
    const use = await this.challenges.consume(
      {
        challengeHash: expected,
        purpose: 'nativeRegister',
        sessionId: signedIn.id,
      },
      this.clock.now(),
    );
    if (use !== CHALLENGE_USE.CONSUMED) {
      throw this.challengeInvalid('challenge unknown, spent or lapsed');
    }

    const verified = await this.adapter.verifyAttestation(dto.response, {
      challenge: matchesDigest(binding, expected),
      origins: relyingParty.origins,
      rpId: relyingParty.rpId,
      userVerification: this.userVerification(),
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
        rpId: relyingParty.rpId,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
        name: dto.name?.trim() || PASSKEY_DEFAULT_NAME,
      },
      {
        sessionId: signedIn.id,
        clientId: signedIn.clientId,
        userVerified: verified.userVerified,
      },
    );
    this.logger.log(`Native passkey registered for user ${userId}`);
    this.notices?.defer(userId, SECURITY_NOTICE.PASSKEY_ADDED);
    return ApiResponse.success(toPasskeySummary(passkey), 'Passkey added');
  }

  private nativeSessionOf(
    session: NativeRegisteringSession | undefined,
  ): NativeRegisteringSession {
    if (!session || !isNativeSession(session)) throw wrongCredentialKind();
    return session;
  }

  /** A passkey made in the app always verifies its user. */
  private userVerification(): UserVerificationRequirement {
    return registrationUserVerification({
      ceremony: PASSKEY_CEREMONY.NATIVE,
      ...NATIVE_REGISTRATION_POLICY,
    });
  }

  /** @throws AppException FEATURE_DISABLED when the application makes none */
  private relyingPartyOf(
    session: NativeRegisteringSession,
  ): PasskeyRelyingParty {
    const relyingParty = this.relyingParties.of(session.clientId);
    if (!relyingParty) {
      throw new AppException(
        ErrorCode.FEATURE_DISABLED,
        'This application does not make passkeys',
        HttpStatus.NOT_FOUND,
      );
    }
    return relyingParty;
  }

  private challengeInvalid(reason: string): AppException {
    this.logger.warn(`Native passkey challenge rejected: ${reason}`);
    return new AppException(
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      'This passkey attempt is no longer valid. Start again.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private verificationFailed(reason: string): AppException {
    this.logger.warn(`Native passkey registration refused: ${reason}`);
    return new AppException(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
      'That passkey could not be registered',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
