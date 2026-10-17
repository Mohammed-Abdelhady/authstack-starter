import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { BrowserApplications } from '../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { applicationCookieName } from '../../session/utils/request/application-cookie-name';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import {
  EMAIL_CODE_PURPOSE,
  EmailCodeStore,
  type EmailCodeKey,
} from '../pending-codes/email-code.store';
import {
  createMagicLinkToken,
  hashMagicLinkToken,
} from '../magic-link/utils/magic-link-token.util';
import { MAGIC_LINK_NONCE_PATTERN } from '../magic-link/constants/magic-link.constants';
import { Clock } from '../../common/services/clock';
import { EMAIL_CODE_EXPIRES_IN_DEFAULT } from '../../config/constants/host-contracts';

const VERIFY_ROUTE = /^\/(?:api\/)?auth\/email-code\/verify\/?$/u;
const COOKIE_NAME = 'ec_nonce';

export interface BrowserEmailCodeCookieServiceDependencies {
  applications: BrowserApplications;
  sessions: SessionCookieService;
  codes: EmailCodeStore;
  config: ConfigService;
  clock: Clock;
}

@Injectable()
export class BrowserEmailCodeCookieService implements OnModuleInit {
  constructor(
    private readonly dependencies: BrowserEmailCodeCookieServiceDependencies,
  ) {}

  onModuleInit(): void {
    this.dependencies.applications.registerCeremonyReader(
      'email-code',
      async (request) => {
        if (request.method !== 'POST' || !VERIFY_ROUTE.test(request.path))
          return undefined;
        const candidates: BrowserApplicationId[] = [
          WEB_CLIENT_ID,
          ADMIN_CLIENT_ID,
        ];
        const active: BrowserApplicationId[] = [];
        for (const clientId of candidates) {
          if (await this.liveFor(request, clientId)) active.push(clientId);
        }
        return active.length === 1 ? active[0] : undefined;
      },
    );
  }

  private async liveFor(
    request: Request,
    clientId: BrowserApplicationId,
  ): Promise<boolean> {
    if (!this.dependencies.applications.isConfigured(clientId)) return false;
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== this.dependencies.applications.configuration(clientId).origin
    )
      return false;
    const key = this.readFor(request, clientId);
    const stored = key ? await this.dependencies.codes.find(key) : null;
    return (
      stored !== null &&
      stored.expiresAt.getTime() > this.dependencies.clock.now().getTime()
    );
  }

  bind(request: Request, response: Response): EmailCodeKey {
    const clientId = this.dependencies.applications.current(request).clientId;
    const nonce = createMagicLinkToken();
    response.cookie(this.name(clientId), nonce, {
      ...this.options(clientId),
      maxAge: this.dependencies.config.get<number>(
        'emailCode.expiresIn',
        EMAIL_CODE_EXPIRES_IN_DEFAULT,
      ),
    });
    return this.key(clientId, nonce);
  }

  read(request: Request): EmailCodeKey | null {
    return this.readFor(
      request,
      this.dependencies.applications.current(request).clientId,
    );
  }

  release(response: Response): void {
    const clientId = this.dependencies.applications.current(
      response.req,
    ).clientId;
    response.clearCookie(this.name(clientId), this.options(clientId));
  }

  private readFor(
    request: Request,
    clientId: BrowserApplicationId,
  ): EmailCodeKey | null {
    const cookies: unknown = request.cookies;
    const nonce: unknown =
      typeof cookies === 'object' && cookies !== null
        ? Reflect.get(cookies, this.name(clientId))
        : undefined;
    return typeof nonce === 'string' && MAGIC_LINK_NONCE_PATTERN.test(nonce)
      ? this.key(clientId, nonce)
      : null;
  }

  private key(clientId: BrowserApplicationId, nonce: string): EmailCodeKey {
    return {
      ownerId: `browser:${clientId}:${hashMagicLinkToken(nonce)}`,
      purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
    };
  }

  private name(clientId: BrowserApplicationId): string {
    const base = this.dependencies.sessions.optionsFor(clientId).secure
      ? `__Host-${COOKIE_NAME}`
      : COOKIE_NAME;
    return applicationCookieName(base, clientId);
  }

  private options(clientId: BrowserApplicationId): CookieOptions {
    const { httpOnly, secure, sameSite, path } =
      this.dependencies.sessions.optionsFor(clientId);
    return { httpOnly, secure, sameSite, path };
  }
}
