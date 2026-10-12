import { HttpStatus, Injectable } from '@nestjs/common';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { Clock } from '../../../common/services/clock';
import { APPLICATION_PLATFORM } from '../../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { currentSessionDeadlines } from '../../utils/authority/session-authority-rule';
import { hashToken } from '../../utils/hashing/token-hash';
import { ApplicationRegistry } from '../../applications/application-registry';
import {
  NativeCredentialStore,
  NativeFamilySession,
  StoredNativeCredential,
} from '../credentials/native-credential.store';
import { NativeRotationStore } from '../credentials/native-rotation.store';
import { resolveNativeBoundThumbprint } from '../proof/native-bound-thumbprint';
import { NativeBoundRetryService } from '../retry/native-bound-retry.service';
import { asAuthorityUnavailable } from '../../utils/authority/authority-unavailable';
import {
  BoundProofEventContext,
  NativeBoundProofService,
} from '../proof/native-bound-proof.service';
import {
  NativeRefreshRotationService,
  RefreshAuthority,
} from './native-refresh-rotation.service';
import { nativeDpopOauthFailure } from '../proof/native-dpop-oauth';
import { isNativeProofIdReplay } from '../proof/native-dpop.service';
import {
  ClientMeta,
  OAUTH_ERROR,
  OauthFailure,
  TokenSuccess,
  oauthFailure,
} from '../oauth/native-oauth.types';

type ProofEventContext = BoundProofEventContext;

@Injectable()
export class NativeRefreshService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly credentials: NativeCredentialStore,
    private readonly rotations: NativeRotationStore,
    private readonly registry: ApplicationRegistry,
    private readonly issuance: BrowserIssuanceStore,
    private readonly rotation: NativeRefreshRotationService,
    private readonly retries: NativeBoundRetryService,
    private readonly boundProofs: NativeBoundProofService,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async rotate(
    refreshToken: string,
    clientId: string,
    meta: ClientMeta,
    dpopProof?: string,
  ): Promise<TokenSuccess | OauthFailure> {
    const presentedToken = refreshToken.trim();
    const presentedClient = clientId.trim();
    if (!presentedToken || !presentedClient) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    const now = this.clock.now();
    let refusalContext: ProofEventContext | undefined;
    try {
      return await this.unitOfWork.run(async (db) => {
        const presented = await this.credentials.findPresentedCredential(
          db,
          hashToken(presentedToken),
        );
        if (
          !presented ||
          presented.purpose !== CREDENTIAL_PURPOSE.NATIVE_REFRESH ||
          presented.clientId !== presentedClient ||
          presented.revokedAt
        ) {
          return this.invalidGrant();
        }
        const session = await this.credentials.findFamilySession(
          db,
          presented.sessionId,
        );
        const binding = resolveNativeBoundThumbprint(
          session?.proofKeyThumbprint ?? undefined,
          presented.proofKeyThumbprint ?? undefined,
        );
        if (binding.inconsistent) {
          refusalContext = this.proofEventContext(presented, session);
          await this.boundProofs.recordRefusal(
            db,
            refusalContext,
            NATIVE_DPOP_FAILURE_REASON.CONFIGURATION_INVALID,
          );
          return oauthFailure(
            HttpStatus.BAD_REQUEST,
            OAUTH_ERROR.INVALID_DPOP_PROOF,
            NATIVE_DPOP_FAILURE_REASON.CONFIGURATION_INVALID,
          );
        }
        if (!binding.thumbprint) {
          if (this.authEpoch.nativeDpopRequired()) {
            return oauthFailure(
              HttpStatus.BAD_REQUEST,
              OAUTH_ERROR.INVALID_DPOP_PROOF,
              NATIVE_DPOP_FAILURE_REASON.REQUIRED,
            );
          }
          return this.rotateUnbound(
            db,
            presented,
            session,
            presentedClient,
            meta,
            now,
          );
        }
        return this.rotateBound(
          db,
          presented,
          session,
          presentedToken,
          presentedClient,
          meta,
          dpopProof,
          binding.thumbprint,
          now,
          (context) => {
            refusalContext = context;
          },
        );
      });
    } catch (error) {
      if (isNativeProofIdReplay(error) && refusalContext) {
        await this.boundProofs.recordRefusal(
          undefined,
          refusalContext,
          NATIVE_DPOP_FAILURE_REASON.PROOF_REPLAYED,
        );
        return oauthFailure(
          HttpStatus.BAD_REQUEST,
          OAUTH_ERROR.INVALID_DPOP_PROOF,
          NATIVE_DPOP_FAILURE_REASON.PROOF_REPLAYED,
        );
      }
      asAuthorityUnavailable(error);
    }
  }

  private async rotateBound(
    db: UnitOfWork,
    presented: StoredNativeCredential,
    session: NativeFamilySession | null,
    token: string,
    clientId: string,
    meta: ClientMeta,
    dpopProof: string | undefined,
    thumbprint: string,
    now: Date,
    setRefusalContext: (context: ProofEventContext) => void,
  ): Promise<TokenSuccess | OauthFailure> {
    const verification = this.boundProofs.verify(
      dpopProof,
      token,
      thumbprint,
      NATIVE_DPOP_TOKEN_PATH,
      now,
    );
    if (!verification.result.ok) {
      const context = this.proofEventContext(presented, session);
      setRefusalContext(context);
      await this.boundProofs.recordRefusal(
        db,
        context,
        verification.result.reason,
      );
      return nativeDpopOauthFailure(
        verification.result,
        verification.challengeNonce,
      );
    }
    setRefusalContext(this.proofEventContext(presented, session));
    const authority = await this.loadAuthority(db, clientId, session, now);
    if (!authority) {
      if (presented.spent) {
        return this.rotation.replay(db, presented, now);
      }
      return this.invalidGrant();
    }
    if (presented.spent) {
      await this.boundProofs.reserve(db, verification.result.jti, now);
      return this.retries.retryOrReplay({
        unitOfWork: db,
        presented,
        ...authority,
        meta,
        now,
        thumbprint,
        proof: verification.result,
      });
    }
    if (presented.expiresAt.getTime() <= now.getTime()) {
      return this.invalidGrant();
    }
    await this.boundProofs.reserve(db, verification.result.jti, now);
    if (!authority.session.proofKeyThumbprint) {
      await this.rotations.bindSessionKey(db, authority.session.id, thumbprint);
    }
    return this.rotation.claimAndRotate(
      db,
      presented,
      authority,
      meta,
      now,
      thumbprint,
    );
  }

  private async rotateUnbound(
    db: UnitOfWork,
    presented: StoredNativeCredential,
    session: NativeFamilySession | null,
    clientId: string,
    meta: ClientMeta,
    now: Date,
  ): Promise<TokenSuccess | OauthFailure> {
    if (presented.spent) {
      return this.rotation.replay(db, presented, now);
    }
    if (presented.expiresAt.getTime() <= now.getTime()) {
      return this.invalidGrant();
    }
    const authority = await this.loadAuthority(db, clientId, session, now);
    if (!authority) {
      return this.invalidGrant();
    }
    return this.rotation.claimAndRotate(db, presented, authority, meta, now);
  }

  private async loadAuthority(
    db: UnitOfWork,
    clientId: string,
    session: NativeFamilySession | null,
    now: Date,
  ): Promise<RefreshAuthority | undefined> {
    if (!session || session.clientId !== clientId) {
      return undefined;
    }
    const account = await this.issuance.findAccount(db, session.userId);
    const application = await this.registry.findClientIn(db, clientId);
    const grant = account
      ? await this.issuance.findGrant(db, account.id, clientId)
      : null;
    if (
      !account ||
      !application ||
      application.platform !== APPLICATION_PLATFORM.NATIVE ||
      !grant ||
      !currentSessionDeadlines(
        session,
        account,
        application,
        grant,
        now,
        this.authEpoch.current(),
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      )
    ) {
      return undefined;
    }
    return { session, account, application, grant };
  }

  private proofEventContext(
    presented: StoredNativeCredential,
    session: NativeFamilySession | null,
  ): ProofEventContext {
    return {
      ...(session ? { targetUserId: session.userId } : {}),
      sessionId: presented.sessionId,
      clientId: presented.clientId,
    };
  }

  private invalidGrant(): OauthFailure {
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
  }
}
