import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, CookieOptions } from 'express';
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
  constructor(private readonly configService: ConfigService) {}

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

  set(res: Response, token: string): void {
    res.cookie(this.name, token, this.options);
  }

  clear(res: Response): void {
    res.clearCookie(this.name, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
    });
  }

  read(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[this.name];
    if (typeof token === 'string' && token.length > 0) {
      return token;
    }
    return undefined;
  }
}
