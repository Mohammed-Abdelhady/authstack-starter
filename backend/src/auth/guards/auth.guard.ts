import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Sessions } from '../services/sessions/sessions';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { AuthenticatedSession } from '../../session/authority/authenticated-session';
import { AccountIdentity } from '../../session/authority/session-authority.store';
import { RolePermissions } from '../../role/stores/role-permissions';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { effectivePermissions } from '../utils/permissions.util';
import {
  NativeAccessService,
  readBearerToken,
} from '../../session/native/access/native-access.service';
import {
  REQUEST_CREDENTIAL,
  selectRequestCredential,
} from '../../session/utils/request/request-credential';

/**
 * A validated session names its account. Anything else in that place, an id
 * for instance, is refused: the guard never reads fields off it.
 */
export function isPopulatedUser(user: unknown): user is AccountIdentity {
  return typeof user === 'object' && user !== null;
}

export interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    permissions: string[];
    isVerified: boolean;
  };
  session?: AuthenticatedSession;
}

/**
 * Runs on every route as a global guard. Routes marked with `@Public()` pass
 * through without a session. A bearer token wins when one is sent, even when
 * a session cookie is also present. A bearer token that is invalid fails the
 * request; it never falls back to the cookie. Refusing a bearer never clears
 * the session cookie: only a refused cookie does.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: Sessions,
    private readonly sessionCookieService: SessionCookieService,
    private readonly nativeAccess: NativeAccessService,
    private readonly roles: RolePermissions,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const sessionToken = this.sessionCookieService.read(request);
    const bearer = readBearerToken(request);
    const credential = selectRequestCredential(
      bearer !== null,
      sessionToken !== undefined,
    );
    // Only the selected credential was evaluated. Refusing a bearer must
    // never clear the session cookie: the cookie still names a live session.
    const cookieSelected = credential === REQUEST_CREDENTIAL.COOKIE;
    let session: AuthenticatedSession | null;

    if (credential === REQUEST_CREDENTIAL.BEARER && bearer) {
      session = await this.nativeAccess.validate(bearer);
    } else if (cookieSelected && sessionToken) {
      session = await this.sessionService.validateSession(sessionToken);
    } else {
      throw new AppException(
        ErrorCode.SESSION_REQUIRED,
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!session) {
      if (cookieSelected) {
        this.sessionCookieService.clear(response);
      }
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Invalid or expired session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Attach user and session to request for use in controllers
    const user = isPopulatedUser(session.user) ? session.user : null;

    if (!user || user.isDeleted) {
      if (cookieSelected) {
        this.sessionCookieService.clear(response);
      }
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Invalid or expired session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Compute effective permissions (role + direct)
    const permissions = effectivePermissions(
      user.role ? await this.roles.ofRole(user.role) : null,
      user.permissions,
    );

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions,
      isVerified: user.isVerified,
    };
    request.session = session;

    return true;
  }
}
