import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { hostCookieName } from '../utils/cookie-name.util';
import {
  OAUTH_STATE_COOKIE_PREFIX,
  OAUTH_STATE_TTL_MS,
} from './oauth.constants';

export interface OAuthStatePayload {
  /** Random value echoed by the provider as the `state` query parameter. */
  state: string;
  /** PKCE verifier, present when the provider supports PKCE. */
  codeVerifier?: string;
  /** OIDC nonce, present when the provider issues an id_token. */
  nonce?: string;
  /** Sanitised relative path the client returns to after login. */
  redirect: string;
  /** Epoch milliseconds after which the cookie is refused. */
  expiresAt: number;
  /** Login issues a session; link attaches the provider to the current user. */
  intent: 'login' | 'link';
  /** Session user id stored when `intent` is `link`. */
  linkUserId?: string;
  /** The session that asked for the link. It must still be live at the callback. */
  linkSessionId?: string;
}

export interface OAuthStateRequest {
  redirect: string;
  supportsPkce: boolean;
  usesOidc: boolean;
  intent?: 'login' | 'link';
  linkUserId?: string;
  linkSessionId?: string;
}

export interface OAuthStateCreation {
  payload: OAuthStatePayload;
  codeChallenge?: string;
}

const RANDOM_BYTES = 32;

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Issues and verifies the short lived signed cookie that carries OAuth state,
 * the PKCE verifier and the OIDC nonce between the start and callback routes.
 * Cookie value is `<base64url payload>.<base64url HMAC-SHA256>`.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly configService: ConfigService) {}

  cookieName(provider: string): string {
    return hostCookieName(
      this.configService.get<string>('NODE_ENV'),
      `${OAUTH_STATE_COOKIE_PREFIX}${provider}`,
    );
  }

  create(request: OAuthStateRequest): OAuthStateCreation {
    const payload: OAuthStatePayload = {
      state: randomBytes(RANDOM_BYTES).toString('base64url'),
      redirect: request.redirect,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
      intent: request.intent === 'link' ? 'link' : 'login',
    };

    if (payload.intent === 'link') {
      payload.linkUserId = request.linkUserId;
      payload.linkSessionId = request.linkSessionId;
    }

    if (request.usesOidc) {
      payload.nonce = randomBytes(RANDOM_BYTES).toString('base64url');
    }

    if (!request.supportsPkce) {
      return { payload };
    }

    const codeVerifier = randomBytes(RANDOM_BYTES).toString('base64url');
    payload.codeVerifier = codeVerifier;

    return {
      payload,
      codeChallenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
    };
  }

  /**
   * @param crossSite true for providers whose callback arrives as a cross site
   * POST, which a SameSite=Lax cookie would not be sent with
   */
  write(
    res: Response,
    provider: string,
    payload: OAuthStatePayload,
    crossSite = false,
  ): void {
    res.cookie(this.cookieName(provider), this.encode(payload), {
      ...this.cookieOptions(crossSite),
      maxAge: OAUTH_STATE_TTL_MS,
    });
  }

  clear(res: Response, provider: string): void {
    res.clearCookie(this.cookieName(provider), this.cookieOptions());
  }

  /**
   * Reads and verifies the state cookie.
   *
   * @throws AppException OAUTH_STATE_INVALID when it is missing, tampered with or expired
   */
  read(req: Request, provider: string): OAuthStatePayload {
    const cookies = req.cookies as Record<string, string> | undefined;
    const raw = cookies?.[this.cookieName(provider)];

    if (typeof raw !== 'string' || raw.length === 0) {
      throw this.invalidState(provider, 'missing state cookie');
    }

    const separator = raw.lastIndexOf('.');
    if (separator <= 0) {
      throw this.invalidState(provider, 'malformed state cookie');
    }

    const encodedPayload = raw.slice(0, separator);
    const signature = raw.slice(separator + 1);

    if (!this.constantTimeEquals(signature, this.sign(encodedPayload))) {
      throw this.invalidState(provider, 'state cookie signature mismatch');
    }

    const payload = this.decode(encodedPayload, provider);

    if (payload.expiresAt <= Date.now()) {
      throw this.invalidState(provider, 'state cookie expired');
    }

    return payload;
  }

  /**
   * Compares the state echoed by the provider with the signed cookie value.
   *
   * @throws AppException OAUTH_STATE_INVALID on mismatch
   */
  assertStateMatches(
    payload: OAuthStatePayload,
    received: unknown,
    provider: string,
  ): void {
    if (
      typeof received !== 'string' ||
      !this.constantTimeEquals(received, payload.state)
    ) {
      throw this.invalidState(provider, 'state parameter mismatch');
    }
  }

  /**
   * SameSite=None only holds up with Secure, so it is limited to production.
   * A cross site provider therefore needs an HTTPS callback URL; in development
   * the cookie stays Lax and the POST callback drops it.
   */
  private cookieOptions(crossSite = false): CookieOptions {
    const isProduction = this.isProduction();

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: crossSite && isProduction ? 'none' : 'lax',
      path: this.cookiePath(),
    };
  }

  private isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * The production name carries `__Host-`, which a browser only accepts on
   * path `/`. Elsewhere the cookie stays on the callback path.
   */
  private cookiePath(): string {
    if (this.isProduction()) {
      return '/';
    }
    const baseUrl = this.configService.get<string>('oauth.callbackBaseUrl');
    if (!baseUrl) {
      return '/';
    }
    try {
      return new URL(baseUrl).pathname || '/';
    } catch {
      return '/';
    }
  }

  private encode(payload: OAuthStatePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }

  private decode(encoded: string, provider: string): OAuthStatePayload {
    try {
      const json = Buffer.from(encoded, 'base64url').toString('utf8');
      const payload = JSON.parse(json) as OAuthStatePayload;
      if (
        typeof payload.state !== 'string' ||
        typeof payload.expiresAt !== 'number'
      ) {
        throw new Error('missing fields');
      }
      if (payload.intent === 'link') {
        if (!isFilled(payload.linkUserId) || !isFilled(payload.linkSessionId)) {
          throw new Error('missing link user or session');
        }
      } else {
        payload.intent = 'login';
      }
      return payload;
    } catch {
      throw this.invalidState(provider, 'unreadable state cookie');
    }
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.secret())
      .update(encodedPayload)
      .digest('base64url');
  }

  private secret(): string {
    const secret = this.configService.get<string>('oauth.stateSecret');
    if (!secret) {
      throw new AppException(
        ErrorCode.OAUTH_NOT_CONFIGURED,
        'OAUTH_STATE_SECRET is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return secret;
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    if (leftBytes.length !== rightBytes.length) {
      return false;
    }
    return timingSafeEqual(leftBytes, rightBytes);
  }

  private invalidState(provider: string, reason: string): AppException {
    return new AppException(
      ErrorCode.OAUTH_STATE_INVALID,
      `OAuth state validation failed: ${reason}`,
      HttpStatus.UNAUTHORIZED,
      { provider },
    );
  }
}
