import {
  APPLICATION_COOKIE_PLACEHOLDER,
  applicationCookieName,
} from '../../session/utils/request/application-cookie-name';
import {
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
} from '../../session/constants/client-ids';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { hostCookieName } from '../utils/cookie-name.util';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import type {
  OAuthStateCreation,
  OAuthStatePayload,
  OAuthStateRequest,
} from './types/oauth-state.types';
import {
  OAUTH_STATE_COOKIE_PREFIX,
  OAUTH_STATE_TTL_MS,
} from './oauth.constants';
import {
  isFilled,
  readOAuthStatePayload,
} from './utils/oauth-state-payload.util';

export type {
  OAuthStateCreation,
  OAuthStatePayload,
  OAuthStateRequest,
} from './types/oauth-state.types';

const RANDOM_BYTES = 32;
const BROWSER_APPLICATIONS: readonly BrowserApplicationId[] = [
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
];
const DEFAULT_CLIENT_URL = 'http://localhost:3000';

interface StateCookieCandidate {
  name: string;
  clientId: BrowserApplicationId;
  legacy: boolean;
}

@Injectable()
export class OAuthStateService {
  private readonly selectedCookies = new WeakMap<OAuthStatePayload, string>();

  constructor(private readonly configService: ConfigService) {}

  cookieName(
    provider: string,
    clientId: BrowserApplicationId = WEB_CLIENT_ID,
  ): string {
    return this.namedCookie(
      applicationCookieName(
        `${OAUTH_STATE_COOKIE_PREFIX}${APPLICATION_COOKIE_PLACEHOLDER}_${provider}`,
        clientId,
      ),
    );
  }

  legacyCookieName(provider: string): string {
    return this.namedCookie(`${OAUTH_STATE_COOKIE_PREFIX}${provider}`);
  }

  create(request: OAuthStateRequest): OAuthStateCreation {
    const clientId = request.clientId ?? WEB_CLIENT_ID;
    const configuredBase = this.returnBaseFor(clientId);
    const returnBase = request.returnBase ?? configuredBase;
    if (!isFilled(returnBase) || returnBase !== configuredBase) {
      throw this.invalidState(
        clientId,
        'application return base is not configured',
      );
    }
    const payload: OAuthStatePayload = {
      state: randomBytes(RANDOM_BYTES).toString('base64url'),
      redirect: request.redirect,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
      intent: request.intent === 'link' ? 'link' : 'login',
      clientId,
      returnBase,
    };
    if (payload.intent === 'link') {
      payload.linkUserId = request.linkUserId;
      payload.linkSessionId = request.linkSessionId;
    }
    if (request.usesOidc) {
      payload.nonce = randomBytes(RANDOM_BYTES).toString('base64url');
    }
    if (!request.supportsPkce) return { payload };
    const codeVerifier = randomBytes(RANDOM_BYTES).toString('base64url');
    payload.codeVerifier = codeVerifier;
    return {
      payload,
      codeChallenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
    };
  }

  write(
    res: Response,
    provider: string,
    payload: OAuthStatePayload,
    crossSite = false,
  ): void {
    const name = this.cookieName(provider, payload.clientId);
    res.cookie(name, this.encode(payload), {
      ...this.cookieOptions(crossSite),
      maxAge: OAUTH_STATE_TTL_MS,
    });
    this.selectedCookies.set(payload, name);
  }

  clear(res: Response, _provider: string, payload?: OAuthStatePayload): void {
    const name = payload && this.selectedCookies.get(payload);
    if (name) res.clearCookie(name, this.cookieOptions());
  }

  readForStart(req: Request, provider: string): OAuthStatePayload {
    const name = this.cookieName(provider);
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const raw = cookies?.[name];
    if (!isFilled(raw)) {
      throw this.invalidState(provider, 'no matching valid state cookie');
    }
    const payload = this.verifiedPayload(raw, provider, WEB_CLIENT_ID, false);
    this.selectedCookies.set(payload, name);
    return payload;
  }

  readCallback(
    req: Request,
    provider: string,
    receivedState: unknown,
  ): OAuthStatePayload {
    if (!isFilled(receivedState)) {
      throw this.invalidState(provider, 'missing state parameter');
    }
    const candidates: StateCookieCandidate[] = [
      ...BROWSER_APPLICATIONS.map((clientId) => ({
        name: this.cookieName(provider, clientId),
        clientId,
        legacy: false,
      })),
      {
        name: this.legacyCookieName(provider),
        clientId: WEB_CLIENT_ID,
        legacy: true,
      },
    ];
    const cookies = req.cookies as Record<string, unknown> | undefined;
    let selected: OAuthStatePayload | undefined;
    for (const candidate of candidates) {
      const raw = cookies?.[candidate.name];
      if (!isFilled(raw)) continue;
      let payload: OAuthStatePayload;
      try {
        payload = this.verifiedPayload(
          raw,
          provider,
          candidate.clientId,
          candidate.legacy,
        );
        this.assertStateMatches(payload, receivedState, provider);
      } catch (error) {
        if (
          !(error instanceof AppException) ||
          error.getCode() !== ErrorCode.OAUTH_STATE_INVALID
        ) {
          throw error;
        }
        continue;
      }
      if (selected)
        throw this.invalidState(provider, 'ambiguous state cookies');
      selected = payload;
      this.selectedCookies.set(payload, candidate.name);
    }
    if (!selected) {
      throw this.invalidState(provider, 'no matching valid state cookie');
    }
    return selected;
  }

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

  private verifiedPayload(
    raw: string,
    provider: string,
    clientId: BrowserApplicationId,
    legacy: boolean,
  ): OAuthStatePayload {
    const separator = raw.lastIndexOf('.');
    if (separator <= 0) {
      throw this.invalidState(provider, 'malformed state cookie');
    }
    const encoded = raw.slice(0, separator);
    if (
      !this.constantTimeEquals(raw.slice(separator + 1), this.sign(encoded))
    ) {
      throw this.invalidState(provider, 'state cookie signature mismatch');
    }
    const payload = this.decode(encoded, provider, clientId, legacy);
    if (payload.expiresAt <= Date.now()) {
      throw this.invalidState(provider, 'state cookie expired');
    }
    return payload;
  }

  private decode(
    encoded: string,
    provider: string,
    clientId: BrowserApplicationId,
    legacy: boolean,
  ): OAuthStatePayload {
    try {
      const returnBase = this.returnBaseFor(clientId);
      if (!isFilled(returnBase)) {
        throw new Error('application is not configured');
      }
      const parsed: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      return readOAuthStatePayload(parsed, { clientId, returnBase, legacy });
    } catch {
      throw this.invalidState(provider, 'unreadable state cookie');
    }
  }

  private returnBaseFor(clientId: BrowserApplicationId): string | undefined {
    return clientId === ADMIN_CLIENT_ID
      ? this.configService.get<string>('cors.adminUrl')
      : this.configService.get<string>('cors.clientUrl', DEFAULT_CLIENT_URL);
  }

  private namedCookie(name: string): string {
    return hostCookieName(this.configService.get<string>('NODE_ENV'), name);
  }

  private cookieOptions(crossSite = false): CookieOptions {
    const production =
      this.configService.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: production,
      sameSite: crossSite && production ? 'none' : 'lax',
      path: production ? '/' : this.cookiePath(),
    };
  }

  private cookiePath(): string {
    const baseUrl = this.configService.get<string>('oauth.callbackBaseUrl');
    if (!baseUrl) return '/';
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

  private sign(encoded: string): string {
    const secret = this.configService.get<string>('oauth.stateSecret');
    if (!secret) {
      throw new AppException(
        ErrorCode.OAUTH_NOT_CONFIGURED,
        'OAUTH_STATE_SECRET is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return createHmac('sha256', secret).update(encoded).digest('base64url');
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
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
