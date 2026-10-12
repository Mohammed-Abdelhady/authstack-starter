import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, CookieOptions } from 'express';
import { hostCookieName } from '../../utils/cookie-name.util';

export function resolveSessionCookieName(
  nodeEnv: string | undefined,
  configuredName: string | undefined,
): string {
  if (configuredName) {
    return configuredName;
  }
  return hostCookieName(nodeEnv, 'sid');
}

@Injectable()
export class SessionCookieService {
  constructor(private readonly configService: ConfigService) {}

  get name(): string {
    return resolveSessionCookieName(
      this.configService.get<string>('NODE_ENV'),
      this.configService.get<string>('session.cookieName'),
    );
  }

  get options(): CookieOptions {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const maxAge = this.configService.get<number>(
      'session.cookieMaxAge',
      604800000,
    );

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge,
    };
  }

  set(res: Response, token: string): void {
    res.cookie(this.name, token, this.options);
  }

  clear(res: Response): void {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.clearCookie(this.name, {
      httpOnly: true,
      secure: isProduction,
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
