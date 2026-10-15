import { applicationCookieName } from '../../../session/utils/request/application-cookie-name';
import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  SecondFactorChallengeStore,
  StoredSecondFactorChallenge,
} from '../stores/second-factor-challenge.store';
import { TotpSecretCryptoService } from './totp-secret-crypto.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  FirstFactor,
  isFirstFactor,
} from '../../services/sessions/first-factor';
import {
  TWO_FACTOR_CHALLENGE_COOKIE,
  TWO_FACTOR_CHALLENGE_TTL_MS,
  TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS,
} from '../constants/two-factor.constants';

interface ChallengePayload {
  /** Missing only in a legacy web challenge. */
  clientId?: BrowserApplicationId;
  /** User the half-finished login belongs to. */
  sub: string;
  /** Random value matching the stored record. */
  nonce: string;
  /** Epoch milliseconds after which the token is refused. */
  expiresAt: number;
  /** What the first step of this sign-in proved. */
  firstFactor: FirstFactor;
}

export interface TwoFactorChallengeContext {
  challengeId: string;
  userId: string;
  firstFactor: FirstFactor;
}

const NONCE_BYTES = 32;

/**
 * The half-finished login between a first factor and a TOTP code.
 *
 * The cookie value is `<base64url payload>.<base64url HMAC-SHA256>`, signed
 * with a key derived from TOTP_ENCRYPTION_KEY. The wrong-code count lives in a
 * short lived record rather than in the token, so a client that edits its own
 * cookie cannot reset it.
 *
 * The record is stored under a hash of the nonce and the first factor
 * together. A cookie that names another first factor finds no record.
 */
@Injectable()
export class TwoFactorChallengeService {
  private readonly logger = new Logger(TwoFactorChallengeService.name);

  constructor(
    private readonly challenges: SecondFactorChallengeStore,
    private readonly configService: ConfigService,
    private readonly cryptoService: TotpSecretCryptoService,
    private readonly applications: BrowserApplications,
  ) {}

  /** Opens a challenge for a user who passed the first factor named. */
  async issue(
    userId: string | { toString(): string },
    response: Response,
    firstFactor: FirstFactor,
  ): Promise<void> {
    const application = await this.applications.resolve(response.req);
    this.applications.assertEnabled(application);
    const sub = userId.toString();
    const nonce = randomBytes(NONCE_BYTES).toString('base64url');
    const expiresAt = Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS;

    await this.challenges.open({
      userId: sub,
      nonceHash: hashNonce(nonce, firstFactor),
      expiresAt: new Date(expiresAt),
    });

    const token = this.encode({
      sub,
      nonce,
      expiresAt,
      firstFactor,
      clientId: application.clientId,
    });
    response.cookie(this.cookieName(response.req), token, {
      ...this.cookieOptions(),
      maxAge: TWO_FACTOR_CHALLENGE_TTL_MS,
    });
  }

  /**
   * Reads the cookie and the record behind it.
   *
   * @throws AppException TWO_FACTOR_CHALLENGE_INVALID when the cookie is
   * missing, tampered with, expired, already spent, or out of attempts
   */
  async read(request: Request): Promise<TwoFactorChallengeContext> {
    await this.applications.resolve(request);
    const payload = this.decodeCookie(request);
    const challenge = await this.challenges.find({
      nonceHash: hashNonce(payload.nonce, payload.firstFactor),
      userId: payload.sub,
    });

    if (!challenge) {
      throw this.invalid('challenge is unknown or already spent');
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.challenges.discard(challenge.id);
      throw this.invalid('challenge has expired');
    }

    if (challenge.attempts >= TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS) {
      await this.challenges.discard(challenge.id);
      throw this.invalid('too many wrong codes');
    }

    return toContext(challenge, payload.firstFactor);
  }

  /**
   * Same as read, then marks the challenge claimed so a second request with
   * the same cookie cannot also verify a factor and issue a session.
   *
   * @throws AppException TWO_FACTOR_CHALLENGE_INVALID when the cookie is
   * missing, spent, expired, already claimed, or out of attempts
   */
  async claim(request: Request): Promise<TwoFactorChallengeContext> {
    await this.applications.resolve(request);
    const payload = this.decodeCookie(request);
    const challenge = await this.challenges.claim(
      {
        nonceHash: hashNonce(payload.nonce, payload.firstFactor),
        userId: payload.sub,
      },
      {
        now: new Date(Date.now()),
        maxAttempts: TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS,
      },
    );

    if (!challenge) {
      throw this.invalid('challenge is unknown, spent, or already claimed');
    }

    return toContext(challenge, payload.firstFactor);
  }

  /**
   * Counts one wrong code and releases the claim so another try can proceed.
   * The challenge is dropped once the count reaches the cap.
   */
  async registerFailure(challengeId: string): Promise<void> {
    const counted = await this.challenges.countFailure(challengeId);

    if (counted && counted.attempts >= TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS) {
      await this.challenges.discard(challengeId);
      this.logger.warn('Two-factor challenge discarded after too many tries');
    }
  }

  async consume(challengeId: string): Promise<void> {
    await this.challenges.discard(challengeId);
  }

  clear(response: Response): void {
    response.clearCookie(this.cookieName(response.req), this.cookieOptions());
  }

  private cookieName(request: Request): string {
    const application = this.applications.current(request);
    return applicationCookieName(
      TWO_FACTOR_CHALLENGE_COOKIE,
      application.clientId,
    );
  }

  private decodeCookie(request: Request): ChallengePayload {
    const cookies = request.cookies as Record<string, string> | undefined;
    const raw = cookies?.[this.cookieName(request)];

    if (typeof raw !== 'string' || raw.length === 0) {
      throw this.invalid('missing challenge cookie');
    }

    const separator = raw.lastIndexOf('.');
    if (separator <= 0) {
      throw this.invalid('malformed challenge cookie');
    }

    const encoded = raw.slice(0, separator);
    if (!constantTimeEquals(raw.slice(separator + 1), this.sign(encoded))) {
      throw this.invalid('challenge cookie signature mismatch');
    }

    const payload = this.decode(encoded);
    if (
      (payload.clientId ?? WEB_CLIENT_ID) !==
      this.applications.current(request).clientId
    ) {
      throw this.invalid('challenge belongs to another application');
    }
    if (payload.expiresAt <= Date.now()) {
      throw this.invalid('challenge cookie expired');
    }

    return payload;
  }

  private encode(payload: ChallengePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }

  private decode(encoded: string): ChallengePayload {
    try {
      const json = Buffer.from(encoded, 'base64url').toString('utf8');
      const payload = JSON.parse(json) as ChallengePayload;
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.nonce !== 'string' ||
        typeof payload.expiresAt !== 'number' ||
        !isFirstFactor(payload.firstFactor) ||
        (payload.clientId !== undefined &&
          payload.clientId !== WEB_CLIENT_ID &&
          payload.clientId !== ADMIN_CLIENT_ID) ||
        !this.challenges.isAccountId(payload.sub)
      ) {
        throw new Error('missing fields');
      }
      return payload;
    } catch {
      throw this.invalid('unreadable challenge cookie');
    }
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.cryptoService.challengeKey())
      .update(encodedPayload)
      .digest('base64url');
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

  private invalid(reason: string): AppException {
    this.logger.warn(`Two-factor challenge rejected: ${reason}`);
    return new AppException(
      ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
      'This sign-in attempt is no longer valid. Start again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

function toContext(
  challenge: StoredSecondFactorChallenge,
  firstFactor: FirstFactor,
): TwoFactorChallengeContext {
  return { challengeId: challenge.id, userId: challenge.userId, firstFactor };
}

/** A nonce is base64url, so the separator cannot be part of it. */
function hashNonce(nonce: string, firstFactor: FirstFactor): string {
  return createHash('sha256').update(`${nonce}.${firstFactor}`).digest('hex');
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
