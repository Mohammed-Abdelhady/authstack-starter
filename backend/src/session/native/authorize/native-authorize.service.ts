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
import { addMs } from '../../utils/session/session-deadline';
import { hashToken, randomSecret } from '../../utils/hashing/token-hash';
import { isAcceptableRedirectUri } from '../../utils/oauth/redirect-uri.util';
import type { RedirectUriPolicy } from '../../utils/oauth/redirect-uri.util';
import { matchesRegisteredRedirectUri } from '../../utils/oauth/redirect-uri.util';
import { AuthorizeBegin, OauthFailure } from '../oauth/native-oauth.types';
import {
  AUTHORIZATION_APPROVAL,
  GRANT_VERSION_CAPTURE,
  NativeAuthorizationStore,
} from './native-authorization.store';
import { validateNativeAuthorizationRequest } from './native-authorize-validation';
import type { ValidatedNativeAuthorization } from '../types/native-authorization';
import {
  appendAuthorizationCode,
  expiredTransaction,
  incompleteApproval,
} from './native-authorization-result';
import type {
  NativeAttempt,
  VerifiedNativeAccount,
} from '../../../auth/native/types/native-attempt';

interface ApprovedAuthorization {
  redirectUri: string;
  state: string;
  code: string;
}

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
    const validated = await this.validateRequest(query);
    if ('ok' in validated) return validated;

    const now = this.clock.now();
    const transactionId = randomUUID();
    await this.store.createPending({
      transactionId,
      clientId: validated.clientId,
      redirectUri: validated.redirectUri,
      codeChallenge: validated.codeChallenge,
      state: validated.state,
      requestedScopes: validated.requestedScopes,
      audience: DEFAULT_API_AUDIENCE,
      expiresAt: addMs(now, PENDING_AUTH_LIFETIME_MS),
      authEpoch: this.authEpoch.current(),
    });
    return { ok: true, transactionId };
  }

  async validateRequest(
    query: unknown,
  ): Promise<ValidatedNativeAuthorization | OauthFailure> {
    return validateNativeAuthorizationRequest(
      query,
      this.registry,
      this.authEpoch,
    );
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

  /** The native attempt already holds a server-verified principal. The caller owns this UOW. */
  async approveVerifiedIn(
    unitOfWork: UnitOfWork,
    attempt: NativeAttempt,
    principal: VerifiedNativeAccount,
  ): Promise<{ redirectUri: string; expiresAt: Date }> {
    const now = this.clock.now();
    if (
      attempt.authEpoch !== this.authEpoch.current() ||
      attempt.clientId.length === 0 ||
      principal.userId.length === 0
    )
      throw expiredTransaction();
    await this.assertVerifiedCurrentIn(unitOfWork, attempt, principal);
    const transactionId = randomUUID();
    await this.store.createPendingIn(unitOfWork, {
      transactionId,
      clientId: attempt.clientId,
      redirectUri: attempt.redirectUri,
      codeChallenge: attempt.codeChallenge,
      state: attempt.state,
      requestedScopes: attempt.requestedScopes,
      audience: DEFAULT_API_AUDIENCE,
      expiresAt: addMs(now, AUTHORIZATION_CODE_LIFETIME_MS),
      authEpoch: attempt.authEpoch,
    });
    const approved = await this.approveIn(
      unitOfWork,
      principal.userId,
      transactionId,
      principal.authenticationMethods,
      principal,
    );
    return {
      redirectUri: appendAuthorizationCode(
        approved.redirectUri,
        approved.code,
        approved.state,
      ),
      expiresAt: addMs(now, AUTHORIZATION_CODE_LIFETIME_MS),
    };
  }

  async assertVerifiedCurrentIn(
    unitOfWork: UnitOfWork,
    attempt: NativeAttempt,
    principal: VerifiedNativeAccount,
  ): Promise<void> {
    if (attempt.authEpoch !== this.authEpoch.current())
      throw expiredTransaction();
    const account = await this.issuance.readAccountForIssuance(
      unitOfWork,
      principal.userId,
    );
    if (
      !account ||
      account.isDeleted ||
      account.sessionVersion !== principal.userVersion
    )
      throw expiredTransaction();
    const application = await this.registry.findClientIn(
      unitOfWork,
      attempt.clientId,
    );
    if (
      !application ||
      !application.enabled ||
      application.platform !== APPLICATION_PLATFORM.NATIVE ||
      application.clientType !== APPLICATION_CLIENT_TYPE.PUBLIC ||
      application.sessionVersion !== principal.clientVersion ||
      !isAcceptableRedirectUri(attempt.redirectUri, this.redirectPolicy()) ||
      !application.redirectUris.some((registered) =>
        matchesRegisteredRedirectUri(registered, attempt.redirectUri),
      )
    ) {
      throw expiredTransaction();
    }
    const grant = await this.grants.takeGrantForChange(
      unitOfWork,
      principal.userId,
      attempt.clientId,
    );
    if (
      (grant?.sessionVersion ?? null) !== principal.grantVersion ||
      grant?.allowed === false
    )
      throw expiredTransaction();
  }

  private async approveIn(
    unitOfWork: UnitOfWork,
    userId: string,
    transactionId: string,
    authenticationMethods: string[],
    expected?: VerifiedNativeAccount,
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
    if (expected && account.sessionVersion !== expected.userVersion)
      throw expiredTransaction();
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
    if (expected && application.sessionVersion !== expected.clientVersion)
      throw expiredTransaction();
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
    const grant = await this.allowGrant(
      unitOfWork,
      account.id,
      application,
      expected?.grantVersion,
    );
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

  private async allowGrant(
    unitOfWork: UnitOfWork,
    userId: string,
    application: RegisteredClient,
    expectedVersion?: number | null,
  ): Promise<{ sessionVersion: number }> {
    const existing = await this.grants.takeGrantForChange(
      unitOfWork,
      userId,
      application.clientId,
    );
    if (
      expectedVersion !== undefined &&
      (existing?.sessionVersion ?? null) !== expectedVersion
    ) {
      throw expiredTransaction();
    }
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
