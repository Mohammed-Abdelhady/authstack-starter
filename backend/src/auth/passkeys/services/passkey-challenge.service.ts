import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { createHash, hkdfSync } from 'crypto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  decodeSignedCookie,
  encodeSignedCookie,
} from '../utils/signed-cookie.util';
import {
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_CHALLENGE_HKDF_INFO,
  PASSKEY_CHALLENGE_KEY_BYTES,
  PASSKEY_CHALLENGE_TTL_MS,
  PasskeyChallengePurpose,
} from '../constants/passkeys.constants';
import {
  CHALLENGE_USE,
  PasskeyChallengeStore,
} from '../stores/passkey-challenge.store';

export interface PasskeyChallengePayload {
  purpose: PasskeyChallengePurpose;
  /** The base64url challenge the authenticator signs over. */
  challenge: string;
  /** Account the challenge was issued to. Registration only; login is open. */
  sub?: string;
  /**
   * Session that proved itself before the challenge was issued. Registration
   * only: the proof is good for this challenge and for no other session.
   */
  sid?: string;
  /** Epoch milliseconds after which the cookie is refused. */
  expiresAt: number;
}

/**
 * The five minutes between "give me options" and "here is the signed
 * response". The signed cookie carries the challenge for the authenticator;
 * a hashed copy is stored so a copied cookie cannot be replayed.
 */
@Injectable()
export class PasskeyChallengeService {
  private readonly logger = new Logger(PasskeyChallengeService.name);

  constructor(
    private readonly challenges: PasskeyChallengeStore,
    private readonly configService: ConfigService,
  ) {}

  async issue(
    response: Response,
    purpose: PasskeyChallengePurpose,
    challenge: string,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    const signingKey = this.key();
    const expiresAt = Date.now() + PASSKEY_CHALLENGE_TTL_MS;
    const payload: PasskeyChallengePayload = {
      purpose,
      challenge,
      sub: userId,
      sid: sessionId,
      expiresAt,
    };

    await this.challenges.open({
      challengeHash: hashChallenge(challenge),
      purpose,
      userId,
      expiresAt: new Date(expiresAt),
    });

    response.cookie(
      PASSKEY_CHALLENGE_COOKIE,
      encodeSignedCookie(payload, signingKey),
      { ...this.cookieOptions(), maxAge: PASSKEY_CHALLENGE_TTL_MS },
    );
  }

  /**
   * @throws AppException PASSKEY_CHALLENGE_INVALID when the cookie is missing,
   * tampered with, expired, or was issued for the other ceremony
   */
  read(
    request: Request,
    purpose: PasskeyChallengePurpose,
  ): PasskeyChallengePayload {
    const cookies = request.cookies as Record<string, string> | undefined;
    const payload = decodeSignedCookie<PasskeyChallengePayload>(
      cookies?.[PASSKEY_CHALLENGE_COOKIE],
      this.key(),
    );

    if (!payload || typeof payload.challenge !== 'string') {
      throw this.invalid('missing or unreadable challenge cookie');
    }

    if (payload.purpose !== purpose) {
      throw this.invalid(`challenge was issued for ${payload.purpose}`);
    }

    if (
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now()
    ) {
      throw this.invalid('challenge has expired');
    }

    return payload;
  }

  /**
   * Spend the stored challenge. A copied cookie that still verifies still
   * fails here once the first request has consumed the record.
   */
  async consume(
    purpose: PasskeyChallengePurpose,
    challenge: string,
  ): Promise<void> {
    const use = await this.challenges.consume(
      { challengeHash: hashChallenge(challenge), purpose },
      new Date(Date.now()),
    );

    if (use !== CHALLENGE_USE.CONSUMED) {
      throw this.invalid('challenge already spent');
    }
  }

  clear(response: Response): void {
    response.clearCookie(PASSKEY_CHALLENGE_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
    };
  }

  /**
   * Signed under a key derived from OAUTH_STATE_SECRET, the one secret every
   * deployment has to set. Deriving it under a passkey label keeps it from
   * standing in for the OAuth state key, or the other way round.
   *
   * @throws AppException PASSKEY_NOT_CONFIGURED when the secret is missing
   */
  private key(): Buffer {
    const secret = this.configService.get<string>('oauth.stateSecret');

    if (!secret) {
      throw new AppException(
        ErrorCode.PASSKEY_NOT_CONFIGURED,
        'Passkeys are not configured: OAUTH_STATE_SECRET is not set',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return Buffer.from(
      hkdfSync(
        'sha256',
        secret,
        Buffer.alloc(0),
        PASSKEY_CHALLENGE_HKDF_INFO,
        PASSKEY_CHALLENGE_KEY_BYTES,
      ),
    );
  }

  private invalid(reason: string): AppException {
    this.logger.warn(`Passkey challenge rejected: ${reason}`);
    return new AppException(
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      'This passkey attempt is no longer valid. Start again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

function hashChallenge(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}
