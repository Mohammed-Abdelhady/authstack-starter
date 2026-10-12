import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { SKIP_BROWSER_PROOF } from '../decorators/skip-browser-proof.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { Sessions } from '../services/sessions/sessions';
import { CREDENTIAL_PURPOSE } from '../../session/constants/credential-purpose';
import {
  CSRF_HEADER,
  CSRF_TOKEN_MAX_LENGTH,
  UNSAFE_METHODS,
} from '../../session/constants/browser-proof';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { AuthenticatedSession } from '../../session/authority/authenticated-session';
import { ApplicationRegistry } from '../../session/applications/application-registry';
import { BrowserProofService } from '../../session/services/browser-proof.service';
import { decideOrigin } from '../../session/utils/request/request-origin';
import { secretEquals } from '../../session/utils/hashing/token-hash';
import { readBearerToken } from '../../session/native/access/native-access.service';
import {
  REQUEST_CREDENTIAL,
  hasBothCredentials,
  selectRequestCredential,
} from '../../session/utils/request/request-credential';
import { RequestWithUser } from './auth.guard';

// AuthModule is imported from more than one place, so this guard can be
// registered twice. The second pass must not spend a single-use proof.
const passedRequests = new WeakSet<Request>();

@Injectable()
export class BrowserProofGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionCookie: SessionCookieService,
    private readonly sessions: Sessions,
    private readonly proofs: BrowserProofService,
    private readonly applications: ApplicationRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_BROWSER_PROOF, [
      context.getHandler(),
      context.getClass(),
    ]);
    this.rejectMixedCredentials(request);
    if (
      skip ||
      request.session?.credentialPurpose === CREDENTIAL_PURPOSE.NATIVE_ACCESS ||
      !UNSAFE_METHODS.has(request.method.toUpperCase())
    ) {
      return true;
    }
    if (passedRequests.has(request)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (
      isPublic === true &&
      hasBothCredentials(
        readBearerToken(request) !== null,
        this.sessionCookie.read(request) !== undefined,
      )
    ) {
      throw new AppException(
        ErrorCode.MIXED_CREDENTIALS,
        'Send either the session cookie or an authorization credential',
        HttpStatus.BAD_REQUEST,
      );
    }
    const session = await this.sessionForProof(request, isPublic === true);
    await this.rejectUntrustedOrigin(request, session);
    const presented = presentedToken(request);
    if (presented === undefined) {
      throw new AppException(
        ErrorCode.CSRF_REQUIRED,
        'Browser proof is required',
        HttpStatus.FORBIDDEN,
      );
    }
    if (presented.length === 0 || presented.length > CSRF_TOKEN_MAX_LENGTH) {
      throw new AppException(
        ErrorCode.CSRF_INVALID,
        'Browser proof is invalid',
        HttpStatus.FORBIDDEN,
      );
    }

    if (session && !isPublic) {
      this.assertSessionToken(session, presented);
      passedRequests.add(request);
      return true;
    }
    if (session && this.hasSessionToken(session, presented)) {
      passedRequests.add(request);
      return true;
    }

    await this.proofs.consume(request, presented);
    passedRequests.add(request);
    return true;
  }

  private rejectMixedCredentials(request: Request): void {
    const authorization = request.header('authorization');
    const hasAuthorization =
      typeof authorization === 'string' && authorization.trim().length > 0;
    const credential = selectRequestCredential(
      readBearerToken(request) !== null,
      this.sessionCookie.read(request) !== undefined,
    );
    if (hasAuthorization && credential === REQUEST_CREDENTIAL.COOKIE) {
      throw new AppException(
        ErrorCode.MIXED_CREDENTIALS,
        'Send either the session cookie or an authorization credential',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async sessionForProof(
    request: RequestWithUser,
    isPublic: boolean,
  ): Promise<AuthenticatedSession | undefined> {
    if (request.session) {
      return request.session;
    }
    if (!isPublic) {
      return undefined;
    }
    const token = this.sessionCookie.read(request);
    if (!token) {
      return undefined;
    }
    return (
      (await this.sessions.validateSessionWithoutExtendingIdle(token)) ??
      undefined
    );
  }

  private async rejectUntrustedOrigin(
    request: RequestWithUser,
    session: AuthenticatedSession | undefined,
  ): Promise<void> {
    const clientId = session?.clientId || WEB_CLIENT_ID;
    const application = await this.applications.findByClientId(clientId);
    const decision = decideOrigin({
      originHeader: request.header('origin') ?? '',
      refererHeader: request.header('referer') ?? '',
      fetchSite: request.header('sec-fetch-site') ?? '',
      allowedOrigins: application?.allowedOrigins ?? [],
    });
    if (!decision.ok) {
      throw new AppException(
        ErrorCode.ORIGIN_REJECTED,
        'Request origin is not allowed',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertSessionToken(
    session: AuthenticatedSession,
    presented: string,
  ): void {
    if (!this.hasSessionToken(session, presented)) {
      throw new AppException(
        ErrorCode.CSRF_INVALID,
        'Browser proof is invalid',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private hasSessionToken(
    session: AuthenticatedSession,
    presented: string,
  ): boolean {
    const stored = session.csrfToken;
    return Boolean(stored && secretEquals(presented, stored));
  }
}

function presentedToken(request: Request): string | undefined {
  const raw = request.header(CSRF_HEADER);
  if (raw === undefined) {
    return undefined;
  }
  return raw.trim();
}
