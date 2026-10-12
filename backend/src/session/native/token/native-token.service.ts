import { HttpStatus, Injectable } from '@nestjs/common';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { APPLICATION_PLATFORM } from '../../constants/client-ids';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../../constants/security-event-action';
import { NATIVE_DPOP_FAILURE_REASON } from '../../constants/session-policy';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { asAuthorityUnavailable } from '../../utils/authority/authority-unavailable';
import { pkceMatches } from '../../utils/oauth/pkce';
import { hashToken } from '../../utils/hashing/token-hash';
import { NativeCredentialIssuer } from './native-credential.issuer';
import { NativeRefreshService } from '../refresh/native-refresh.service';
import { NativeRevokeService } from '../revoke/native-revoke.service';
import { SessionIssuanceService } from '../../services/session-issuance.service';
import { ApplicationRegistry } from '../../applications/application-registry';
import {
  CODE_SPEND,
  NativeAuthorizationStore,
} from '../authorize/native-authorization.store';
import { NativeSecurityEvents } from '../credentials/native-security-events';
import { NativeDpopProofResult } from '../proof/native-dpop-proof';
import {
  TOKEN_REQUEST_FIELDS,
  readStringFields,
} from '../oauth/native-request-shape';
import {
  isNativeProofIdReplay,
  NativeDpopService,
} from '../proof/native-dpop.service';
import {
  ClientMeta,
  OAUTH_ERROR,
  OauthFailure,
  RevokeSuccess,
  TokenRequest,
  TokenSuccess,
  oauthFailure,
} from '../oauth/native-oauth.types';

@Injectable()
export class NativeTokenService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly authorizations: NativeAuthorizationStore,
    private readonly registry: ApplicationRegistry,
    private readonly issuance: BrowserIssuanceStore,
    private readonly issuer: NativeCredentialIssuer,
    private readonly refreshes: NativeRefreshService,
    private readonly revocations: NativeRevokeService,
    private readonly sessionIssuance: SessionIssuanceService,
    private readonly dpop: NativeDpopService,
    private readonly events: NativeSecurityEvents,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async grant(
    request: unknown,
    meta: ClientMeta,
    dpopProof?: string,
  ): Promise<TokenSuccess | OauthFailure> {
    if (!this.authEpoch.nativeEnabled()) {
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.UNAUTHORIZED_CLIENT,
        ErrorCode.NATIVE_AUTH_DISABLED,
      );
    }
    const body = readStringFields(request, TOKEN_REQUEST_FIELDS);
    if (!body) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    if (body.client_secret) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_CLIENT);
    }
    if (body.grant_type === 'authorization_code') {
      return this.exchange(body, meta, dpopProof);
    }
    if (body.grant_type === 'refresh_token') {
      return this.refreshes.rotate(
        body.refresh_token ?? '',
        body.client_id ?? '',
        meta,
        dpopProof,
      );
    }
    return oauthFailure(
      HttpStatus.BAD_REQUEST,
      OAUTH_ERROR.UNSUPPORTED_GRANT_TYPE,
    );
  }

  async revoke(
    body: unknown,
    dpopProof?: string,
  ): Promise<RevokeSuccess | OauthFailure> {
    return this.revocations.revoke(body, dpopProof);
  }

  private async exchange(
    body: TokenRequest,
    meta: ClientMeta,
    dpopProof?: string,
  ): Promise<TokenSuccess | OauthFailure> {
    const code = body.code?.trim() ?? '';
    const clientId = body.client_id?.trim() ?? '';
    const redirectUri = body.redirect_uri ?? '';
    const verifier = body.code_verifier ?? '';
    if (!code || !clientId || !redirectUri || !verifier) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    if (dpopProof === undefined && this.authEpoch.nativeDpopRequired()) {
      const now = this.clock.now();
      await this.recordProofRefusal(
        code,
        NATIVE_DPOP_FAILURE_REASON.REQUIRED,
        now,
      );
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.INVALID_DPOP_PROOF,
        NATIVE_DPOP_FAILURE_REASON.REQUIRED,
      );
    }
    let verifiedProof: Extract<NativeDpopProofResult, { ok: true }> | undefined;
    if (dpopProof !== undefined) {
      const proofNow = this.clock.now();
      const verification = this.dpop.verifyExchangeProof(dpopProof, proofNow);
      if (!verification.result.ok) {
        await this.recordProofRefusal(
          code,
          verification.result.reason,
          proofNow,
        );
        const failure = oauthFailure(
          HttpStatus.BAD_REQUEST,
          verification.challengeNonce
            ? OAUTH_ERROR.USE_DPOP_NONCE
            : OAUTH_ERROR.INVALID_DPOP_PROOF,
          verification.result.reason,
        );
        return verification.challengeNonce
          ? { ...failure, dpopNonce: verification.challengeNonce }
          : failure;
      }
      verifiedProof = verification.result;
    }
    const pending = await this.authorizations.findUnspentCode(hashToken(code));
    if (
      !pending ||
      pending.clientId !== clientId ||
      pending.redirectUri !== redirectUri ||
      !pending.userId ||
      !pending.codeExpiresAt ||
      pending.codeExpiresAt.getTime() <= this.clock.now().getTime()
    ) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
    }
    if (!pkceMatches(verifier, pending.codeChallenge)) {
      await this.authorizations.spendCode(pending.id);
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
    }
    try {
      return await this.unitOfWork.run((unitOfWork) =>
        this.consumeCode(unitOfWork, pending.id, meta, verifiedProof),
      );
    } catch (error) {
      if (isNativeProofIdReplay(error)) {
        await this.recordProofRefusal(
          code,
          ErrorCode.NATIVE_DPOP_PROOF_REPLAYED,
          this.clock.now(),
        );
        return oauthFailure(
          HttpStatus.BAD_REQUEST,
          OAUTH_ERROR.INVALID_DPOP_PROOF,
          ErrorCode.NATIVE_DPOP_PROOF_REPLAYED,
        );
      }
      if (
        error instanceof AppException &&
        error.getCode() === ErrorCode.SESSION_LIMIT_REACHED
      ) {
        return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.ACCESS_DENIED);
      }
      asAuthorityUnavailable(error);
    }
  }

  /**
   * One unit of work with two deliberate outcomes. A full session cap throws,
   * so nothing is stored and the code stays usable. A failed authority check
   * returns its failure, so the spent code is stored with it.
   */
  private async consumeCode(
    unitOfWork: UnitOfWork,
    codeId: string,
    meta: ClientMeta,
    proof?: Extract<NativeDpopProofResult, { ok: true }>,
  ): Promise<TokenSuccess | OauthFailure> {
    const now = this.clock.now();
    const pending = await this.authorizations.findUnspentCodeIn(
      unitOfWork,
      codeId,
    );
    if (!pending || !pending.userId || !pending.codeExpiresAt) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
    }
    if (pending.codeExpiresAt.getTime() <= now.getTime()) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
    }
    const account = await this.issuance.readAccountForIssuance(
      unitOfWork,
      pending.userId,
    );
    const application = await this.registry.findClientIn(
      unitOfWork,
      pending.clientId,
    );
    const grant = await this.issuance.findGrant(
      unitOfWork,
      pending.userId,
      pending.clientId,
    );
    const validAuthority = Boolean(
      account &&
      !account.isDeleted &&
      application &&
      application.enabled &&
      application.platform === APPLICATION_PLATFORM.NATIVE &&
      grant &&
      grant.allowed &&
      account.sessionVersion === (pending.capturedUserVersion ?? -1) &&
      application.sessionVersion === (pending.capturedClientVersion ?? -1) &&
      grant.sessionVersion === (pending.capturedGrantVersion ?? -1) &&
      pending.authEpoch === this.authEpoch.current(),
    );
    if (validAuthority && account && application && grant) {
      await this.issuance.markAccountIssuance(unitOfWork, account.id);
      await this.sessionIssuance.assertSessionLimit(
        unitOfWork,
        account,
        application,
        now,
      );
    }
    const spent = await this.authorizations.spendCodeIn(unitOfWork, pending.id);
    if (
      spent !== CODE_SPEND.SPENT ||
      !validAuthority ||
      !account ||
      !application ||
      !grant
    ) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
    }
    if (proof) {
      await this.dpop.reserveProofId(unitOfWork, proof.jti, now);
    }
    return this.issuer.issuePair(unitOfWork, {
      account,
      application,
      grant,
      context: pending,
      meta,
      now,
      generation: 1,
      proofKeyThumbprint: proof?.thumbprint,
    });
  }

  private async recordProofRefusal(
    code: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    const holder = await this.authorizations.findCodeHolder(
      hashToken(code),
      now,
    );
    if (!holder) {
      return;
    }
    await this.events.recordOutsideUnitOfWork({
      targetUserId: holder.userId ?? undefined,
      clientId: holder.clientId,
      action: SECURITY_EVENT_ACTION.NATIVE_DPOP_PROOF_REFUSED,
      reasonCode: reason,
      outcome: SECURITY_EVENT_OUTCOME.FAILED,
    });
  }
}
