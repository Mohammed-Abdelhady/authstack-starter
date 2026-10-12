import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
} from '../../constants/client-ids';
import {
  AUTHORIZATION_CODE_LIFETIME_MS,
  PENDING_AUTH_LIFETIME_MS,
} from '../../constants/session-policy';
import { ApplicationAccessStore } from '../../applications/application-access.store';
import { ApplicationRegistry } from '../../applications/application-registry';
import { RegisteredClient } from '../../applications/application-registry.store';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { isPkceVerifier } from '../../utils/oauth/pkce';
import { addMs } from '../../utils/session/session-deadline';
import { hashToken, randomSecret } from '../../utils/hashing/token-hash';
import { isAcceptableRedirectUri } from '../../utils/oauth/redirect-uri.util';
import type { RedirectUriPolicy } from '../../utils/oauth/redirect-uri.util';
import { matchesRegisteredRedirectUri } from '../../utils/oauth/redirect-uri.util';
import {
  AuthorizeBegin,
  OAUTH_ERROR,
  OauthFailure,
  oauthFailure,
} from '../oauth/native-oauth.types';
import {
  AUTHORIZATION_APPROVAL,
  GRANT_VERSION_CAPTURE,
  NativeAuthorizationStore,
} from './native-authorization.store';
import { isValidAuthorizeQueryShape } from './native-authorize-query.util';

interface ApprovedAuthorization {
  redirectUri: string;
  state: string;
  code: string;
}

const STATE_MAX_LENGTH = 512;

@Injectable()
export class NativeAuthorizeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly store: NativeAuthorizationStore,
    private readonly registry: ApplicationRegistry,
    private readonly grants: ApplicationAccessStore,
    private readonly issuance: BrowserIssuanceStore,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async begin(query: unknown): Promise<AuthorizeBegin | OauthFailure> {
    if (!isValidAuthorizeQueryShape(query)) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    if (!this.authEpoch.nativeEnabled()) {
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.UNAUTHORIZED_CLIENT,
        ErrorCode.NATIVE_AUTH_DISABLED,
      );
    }
    if (query.response_type !== 'code') {
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.UNSUPPORTED_RESPONSE_TYPE,
      );
    }
    const clientId = query.client_id.trim();
    const redirectUri = query.redirect_uri;
    const challenge = query.code_challenge;
    if (
      !clientId ||
      !redirectUri ||
      query.code_challenge_method !== 'S256' ||
      !isPkceVerifier(challenge)
    ) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    const state = query.state;
    if (state.length > STATE_MAX_LENGTH) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }

    const application = await this.registry.lookUpClient(clientId);
    const clientError = this.rejectClient(application, redirectUri);
    if (clientError) {
      return clientError;
    }
    const scopes = this.resolveScopes(application, query.scope);
    if (!scopes) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_SCOPE);
    }

    const now = this.clock.now();
    const transactionId = randomUUID();
    await this.store.createPending({
      transactionId,
      clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
      requestedScopes: scopes,
      audience: DEFAULT_API_AUDIENCE,
      expiresAt: addMs(now, PENDING_AUTH_LIFETIME_MS),
      authEpoch: this.authEpoch.current(),
    });
    return { ok: true, transactionId };
  }

  async approve(
    userId: string,
    transactionId: string,
    authenticationMethods: string[],
  ): Promise<{ redirectUri: string }> {
    if (!this.authEpoch.nativeEnabled()) {
      throw new AppException(
        ErrorCode.NATIVE_AUTH_DISABLED,
        'Native sign-in is disabled',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!transactionId.trim()) {
      throw incompleteApproval();
    }
    let approved: ApprovedAuthorization;
    try {
      approved = await runLeavingFailuresAsRaised(
        this.unitOfWork,
        (unitOfWork) =>
          this.approveIn(
            unitOfWork,
            userId,
            transactionId,
            authenticationMethods,
          ),
      );
    } catch (error) {
      if (error instanceof MalformedIdError) {
        throw incompleteApproval();
      }
      throw error;
    }
    return {
      redirectUri: appendAuthorizationCode(
        approved.redirectUri,
        approved.code,
        approved.state,
      ),
    };
  }

  private async approveIn(
    unitOfWork: UnitOfWork,
    userId: string,
    transactionId: string,
    authenticationMethods: string[],
  ): Promise<ApprovedAuthorization> {
    const now = this.clock.now();
    const account = await this.issuance.findAccount(unitOfWork, userId);
    if (!account || account.isDeleted) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const pending = await this.store.findPendingIn(
      unitOfWork,
      transactionId,
      now,
    );
    if (!pending) {
      throw expiredTransaction();
    }
    if (!isAcceptableRedirectUri(pending.redirectUri, this.redirectPolicy())) {
      throw expiredTransaction();
    }
    const application = await this.registry.findClientIn(
      unitOfWork,
      pending.clientId,
    );
    if (
      !application ||
      !application.enabled ||
      application.platform !== APPLICATION_PLATFORM.NATIVE ||
      application.clientType !== APPLICATION_CLIENT_TYPE.PUBLIC ||
      !application.redirectUris.some((registered) =>
        matchesRegisteredRedirectUri(registered, pending.redirectUri),
      )
    ) {
      throw expiredTransaction();
    }
    const code = randomSecret();
    const codeExpiresAt = addMs(now, AUTHORIZATION_CODE_LIFETIME_MS);
    const codeHash = hashToken(code);
    // Claim the transaction first so competing approvals cannot race on grant creation.
    const claimed = await this.store.approve(unitOfWork, pending.id, {
      now,
      codeHash,
      codeExpiresAt,
      userId: account.id,
      capturedUserVersion: account.sessionVersion,
      capturedClientVersion: application.sessionVersion,
      authenticationMethods: authenticationMethods.slice(0, 10),
    });
    if (claimed !== AUTHORIZATION_APPROVAL.APPROVED) {
      throw expiredTransaction();
    }
    const grant = await this.allowGrant(unitOfWork, account.id, application);
    const captured = await this.store.captureGrantVersion(
      unitOfWork,
      pending.id,
      codeHash,
      grant.sessionVersion,
    );
    if (captured !== GRANT_VERSION_CAPTURE.CAPTURED) {
      throw expiredTransaction();
    }
    return { redirectUri: pending.redirectUri, state: pending.state, code };
  }

  private redirectPolicy(): RedirectUriPolicy {
    return {
      nodeEnv: this.authEpoch.environment(),
      allowCustomScheme: this.authEpoch.nativeCustomSchemeAllowed(),
    };
  }

  private rejectClient(
    application: RegisteredClient | null,
    redirectUri: string,
  ): OauthFailure | null {
    if (
      !application ||
      !application.enabled ||
      application.platform !== APPLICATION_PLATFORM.NATIVE ||
      application.clientType !== APPLICATION_CLIENT_TYPE.PUBLIC
    ) {
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.UNAUTHORIZED_CLIENT,
      );
    }
    if (
      !isAcceptableRedirectUri(redirectUri, this.redirectPolicy()) ||
      !application.redirectUris.some((registered) =>
        matchesRegisteredRedirectUri(registered, redirectUri),
      )
    ) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    return null;
  }

  private resolveScopes(
    application: RegisteredClient | null,
    requested: string | undefined,
  ): string[] | null {
    if (!application) {
      return null;
    }
    const allowed = new Set(application.allowedScopes);
    if (!requested || requested.trim().length === 0) {
      return [...application.allowedScopes];
    }
    const scopes = requested.split(' ').filter((scope) => scope.length > 0);
    if (scopes.length === 0 || scopes.some((scope) => !allowed.has(scope))) {
      return null;
    }
    return scopes;
  }

  private async allowGrant(
    unitOfWork: UnitOfWork,
    userId: string,
    application: RegisteredClient,
  ): Promise<{ sessionVersion: number }> {
    // Taking the grant keeps a block of the same person and client apart from
    // this approval, so the first grant is created by one of them alone.
    const existing = await this.grants.takeGrantForChange(
      unitOfWork,
      userId,
      application.clientId,
    );
    if (existing && !existing.allowed) {
      throw new AppException(
        ErrorCode.GRANT_BLOCKED,
        'Application access is blocked for this account',
        HttpStatus.FORBIDDEN,
      );
    }
    if (existing) {
      return existing;
    }
    return this.issuance.createGrant(unitOfWork, {
      userId,
      clientId: application.clientId,
      allowedScopes: application.allowedScopes,
    });
  }
}

function appendAuthorizationCode(
  redirectUri: string,
  code: string,
  state: string,
): string {
  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  target.searchParams.set('state', state);
  return target.toString();
}

function expiredTransaction(): AppException {
  return new AppException(
    ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    'Native authorization transaction is expired or already ended',
    HttpStatus.NOT_FOUND,
  );
}

function incompleteApproval(): AppException {
  return new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Authorization approval is incomplete',
    HttpStatus.BAD_REQUEST,
  );
}
