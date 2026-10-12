import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { Sessions } from '../services/sessions/sessions';
import {
  MAGIC_LINK_NONCE_COOKIE,
  MAGIC_LINK_NONCE_HOST_COOKIE,
  MAGIC_LINK_NONCE_PATTERN,
} from './constants/magic-link.constants';
import {
  createMagicLinkToken,
  hashMagicLinkToken,
} from './utils/magic-link-token.util';

/**
 * Ties a link to the browser that asked for it. The request leaves a nonce in
 * an HttpOnly cookie and its hash on the link, so a token that arrives from
 * anywhere else can be told apart and has to be confirmed by a person.
 */
@Injectable()
export class MagicLinkBrowserService {
  constructor(
    private readonly sessions: Sessions,
    private readonly sessionCookies: SessionCookieService,
    private readonly configService: ConfigService,
  ) {}

  /** Host-only and `__Host-` prefixed wherever the session cookie is. */
  get cookieName(): string {
    return this.sessionCookies.options.secure
      ? MAGIC_LINK_NONCE_HOST_COOKIE
      : MAGIC_LINK_NONCE_COOKIE;
  }

  /**
   * Leaves the nonce with the browser and returns its hash for the link. A
   * nonce the browser already holds is kept, so every link it asked for
   * matches, not only the last one.
   */
  bind(request: Request, response: Response): string {
    const nonce = this.readNonce(request) ?? createMagicLinkToken();
    response.cookie(this.cookieName, nonce, {
      ...this.cookieOptions(),
      maxAge: this.configService.get<number>('magicLink.expiresIn', 900000),
    });
    return hashMagicLinkToken(nonce);
  }

  /** The hash of the nonce this browser holds, when it holds one. */
  presentedNonceHash(request: Request): string | null {
    const nonce = this.readNonce(request);
    return nonce ? hashMagicLinkToken(nonce) : null;
  }

  release(response: Response): void {
    response.clearCookie(this.cookieName, this.cookieOptions());
  }

  /** The account already signed in on this browser, when one is. */
  async sessionAccountId(request: Request): Promise<string | null> {
    const token = this.sessionCookies.read(request);
    if (!token) {
      return null;
    }
    const session =
      await this.sessions.validateSessionWithoutExtendingIdle(token);
    return session?.user?.id ?? null;
  }

  private readNonce(request: Request): string | null {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const nonce = cookies?.[this.cookieName];
    return typeof nonce === 'string' && MAGIC_LINK_NONCE_PATTERN.test(nonce)
      ? nonce
      : null;
  }

  private cookieOptions(): CookieOptions {
    const { httpOnly, secure, sameSite, path } = this.sessionCookies.options;
    return { httpOnly, secure, sameSite, path };
  }
}
