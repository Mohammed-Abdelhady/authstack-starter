import {
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { createHash, hkdfSync } from 'crypto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import { applicationCookieName } from '../../../session/utils/request/application-cookie-name';
import {
  decodeSignedCookie,
  encodeSignedCookie,
} from '../utils/signed-cookie.util';
import {
  BrowserChallengePurpose,
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_CHALLENGE_HKDF_INFO,
  PASSKEY_CHALLENGE_KEY_BYTES,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_VERIFY_ROUTES,
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
  /** The browser application it was issued for. Missing only in a legacy web challenge. */
  clientId?: BrowserApplicationId;
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

const BROWSER_APPLICATION_IDS: readonly BrowserApplicationId[] = [
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
];

/**
 * The five minutes between "give me options" and "here is the signed
 * response". The signed cookie carries the challenge for the authenticator;
 * a hashed copy is stored so a copied cookie cannot be replayed.
 *
 * A challenge belongs to the browser application it was issued for, and each
 * application keeps it in a cookie of its own. The verify routes are matched
 * to that application from the signed cookie, before the request's origin.
 */
@Injectable()
export class PasskeyChallengeService implements OnModuleInit {
  private readonly logger = new Logger(PasskeyChallengeService.name);

  constructor(
    private readonly challenges: PasskeyChallengeStore,
    private readonly configService: ConfigService,
    private readonly applications: BrowserApplications,
  ) {}

  onModuleInit(): void {
    this.applications.registerCeremonyReader('passkey', (request) =>
      Promise.resolve(this.ceremonyApplication(request)),
    );
  }

  async issue(
    response: Response,
    purpose: BrowserChallengePurpose,
    challenge: string,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    const { clientId } = await this.applications.resolve(response.req);
    const signingKey = this.currentKey();
    const expiresAt = Date.now() + PASSKEY_CHALLENGE_TTL_MS;
    const payload: PasskeyChallengePayload = {
      purpose,
      challenge,
      clientId,
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
      challengeCookieName(clientId),
      encodeSignedCookie(payload, signingKey),
      { ...this.cookieOptions(), maxAge: PASSKEY_CHALLENGE_TTL_MS },
    );
  }

  /**
   * The challenge of the request's application, from that application's
   * cookie.
   *
   * @throws AppException PASSKEY_CHALLENGE_INVALID when the cookie is missing,
   * tampered with, expired, issued for the other ceremony, or issued for
   * another application
   */
  async read(
    request: Request,
    purpose: BrowserChallengePurpose,
  ): Promise<PasskeyChallengePayload> {
    const { clientId } = await this.applications.resolve(request);
    const payload = this.decode(request, clientId);

    if (!payload) {
      throw this.invalid('missing or unreadable challenge cookie');
    }

    const refusal = refusalOf(payload, purpose, clientId, Date.now());
    if (refusal) {
      throw this.invalid(refusal);
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
    response.clearCookie(
      challengeCookieName(this.applications.current(response.req).clientId),
      this.cookieOptions(),
    );
  }

  /**
   * The application a verify request's own challenge names. Only a cookie
   * whose signed application matches its name counts, and only when exactly
   * one does; otherwise the origin decides and `read` refuses a mismatch.
   */
  private ceremonyApplication(
    request: Request,
  ): BrowserApplicationId | undefined {
    const purpose = verifiedPurposeOf(request);
    if (!purpose) return undefined;
    const bound = BROWSER_APPLICATION_IDS.filter((clientId) => {
      const payload = this.decode(request, clientId);
      return (
        payload !== null &&
        refusalOf(payload, purpose, clientId, Date.now()) === null
      );
    });
    return bound.length === 1 ? bound[0] : undefined;
  }

  private decode(
    request: Request,
    clientId: BrowserApplicationId,
  ): PasskeyChallengePayload | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    const raw = cookies?.[challengeCookieName(clientId)];
    const payload = this.readKeys().reduce<PasskeyChallengePayload | null>(
      (found, key) =>
        found ?? decodeSignedCookie<PasskeyChallengePayload>(raw, key),
      null,
    );
    return payload && typeof payload.challenge === 'string' ? payload : null;
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

  /** Dedicated signing key when configured; older deployments use a labeled OAuth key. */
  private currentKey(): Buffer {
    const dedicated = this.configService.get<string>(
      'passkeys.challengeSecret',
    );
    if (dedicated) return deriveKey(dedicated);
    return this.legacyKey();
  }

  private readKeys(): Buffer[] {
    const keys = [this.currentKey()];
    const previous = this.configService.get<string>(
      'passkeys.previousChallengeSecret',
    );
    if (previous) keys.push(deriveKey(previous));
    const legacyUntil = this.configService.get<string>(
      'passkeys.legacyChallengeUntil',
    );
    if (
      this.configService.get<string>('passkeys.challengeSecret') &&
      legacyUntil &&
      Date.parse(legacyUntil) > Date.now()
    ) {
      keys.push(this.legacyKey());
    }
    return keys;
  }

  private legacyKey(): Buffer {
    const secret = this.configService.get<string>('oauth.stateSecret');

    if (!secret) {
      throw new AppException(
        ErrorCode.PASSKEY_NOT_CONFIGURED,
        'Passkeys are not configured: OAUTH_STATE_SECRET is not set',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return deriveKey(secret);
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

/** The web cookie keeps its old name, so a challenge issued before the split is still found. */
function challengeCookieName(clientId: BrowserApplicationId): string {
  return applicationCookieName(PASSKEY_CHALLENGE_COOKIE, clientId);
}

function verifiedPurposeOf(
  request: Request,
): BrowserChallengePurpose | undefined {
  if (request.method !== 'POST') return undefined;
  if (PASSKEY_VERIFY_ROUTES.login.test(request.path)) return 'login';
  if (PASSKEY_VERIFY_ROUTES.register.test(request.path)) return 'register';
  return undefined;
}

/** Why a readable challenge cannot be spent here, or null when it can. */
function refusalOf(
  payload: PasskeyChallengePayload,
  purpose: BrowserChallengePurpose,
  clientId: BrowserApplicationId,
  now: number,
): string | null {
  if (payload.purpose !== purpose) {
    return `challenge was issued for ${payload.purpose}`;
  }
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= now) {
    return 'challenge has expired';
  }
  if ((payload.clientId ?? WEB_CLIENT_ID) !== clientId) {
    return 'challenge belongs to another application';
  }
  return null;
}

function deriveKey(secret: string): Buffer {
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

function hashChallenge(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}
