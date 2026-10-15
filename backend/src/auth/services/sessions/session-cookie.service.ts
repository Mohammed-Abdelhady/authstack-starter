import { applicationCookieName } from '../../../session/utils/request/application-cookie-name';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, CookieOptions } from 'express';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  defaultSessionCookieName,
  usesSecureCookies,
} from '../../../config/utils/production-environment.util';

export function resolveSessionCookieName(
  nodeEnv: string | undefined,
  configuredName: string | undefined,
  clientUrl?: string,
): string {
  if (configuredName) {
    return configuredName;
  }
  return defaultSessionCookieName(nodeEnv, clientUrl);
}

@Injectable()
export class SessionCookieService {
  constructor(
    private readonly configService: ConfigService,
    readonly applications: BrowserApplications,
  ) {}

  get name(): string {
    return resolveSessionCookieName(
      this.configService.get<string>('NODE_ENV'),
      this.configService.get<string>('session.cookieName'),
      this.configService.get<string>('CLIENT_URL'),
    );
  }

  /** Secure in production, and wherever the browser reaches the app over https. */
  private get secure(): boolean {
    return usesSecureCookies(
      this.configService.get<string>('NODE_ENV'),
      this.configService.get<string>('CLIENT_URL'),
    );
  }

  get options(): CookieOptions {
    const maxAge = this.configService.get<number>(
      'session.cookieMaxAge',
      604800000,
    );

    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
      maxAge,
    };
  }

  nameFor(clientId: BrowserApplicationId): string {
    const base =
      clientId === WEB_CLIENT_ID
        ? this.name
        : defaultSessionCookieName(
            this.configService.get<string>('NODE_ENV'),
            this.applications.configuration(clientId).returnBase,
          );
    return applicationCookieName(base, clientId);
  }

  optionsFor(clientId: BrowserApplicationId): CookieOptions {
    return {
      ...this.options,
      secure: usesSecureCookies(
        this.configService.get<string>('NODE_ENV'),
        this.applications.configuration(clientId).returnBase,
      ),
    };
  }

  set(res: Response, token: string, clientId?: BrowserApplicationId): void {
    const selected = clientId ?? this.applications.current(res.req).clientId;
    res.cookie(this.nameFor(selected), token, this.optionsFor(selected));
  }

  clear(res: Response, clientId?: BrowserApplicationId): void {
    const selected = clientId ?? this.applications.current(res.req).clientId;
    const { httpOnly, secure, sameSite, path } = this.optionsFor(selected);
    res.clearCookie(this.nameFor(selected), {
      httpOnly,
      secure,
      sameSite,
      path,
    });
  }

  read(req: Request): string | undefined {
    return this.readFor(req, this.applications.current(req).clientId);
  }

  readFor(req: Request, clientId: BrowserApplicationId): string | undefined {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[this.nameFor(clientId)];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  }

  async assertOrigin(req: Request): Promise<void> {
    const origin = req.headers?.origin;
    const hasCookie =
      this.readFor(req, WEB_CLIENT_ID) !== undefined ||
      this.readFor(req, ADMIN_CLIENT_ID) !== undefined;
    if (
      origin &&
      hasCookie &&
      !(await this.applications.allowedOrigins(req)).includes(origin)
    ) {
      throw new AppException(
        ErrorCode.ORIGIN_REJECTED,
        'Request origin is not allowed',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
