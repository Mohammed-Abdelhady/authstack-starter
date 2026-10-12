import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { Clock } from '../../../common/services/clock';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_REVOKE_PATH,
} from '../../constants/session-policy';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  NativeCredentialStore,
  NativeFamilySession,
  StoredNativeCredential,
} from '../credentials/native-credential.store';
import { NativeBoundProofService } from '../proof/native-bound-proof.service';
import { resolveNativeBoundThumbprint } from '../proof/native-bound-thumbprint';
import { NativeCredentialIssuer } from '../token/native-credential.issuer';
import { nativeDpopOauthFailure } from '../proof/native-dpop-oauth';
import { isNativeProofIdReplay } from '../proof/native-dpop.service';
import {
  REVOKE_REQUEST_FIELDS,
  readStringFields,
} from '../oauth/native-request-shape';
import {
  OAUTH_ERROR,
  OauthFailure,
  RevokeSuccess,
  oauthFailure,
} from '../oauth/native-oauth.types';

interface ProofEventContext {
  targetUserId?: string;
  sessionId: string;
  clientId: string;
}

@Injectable()
export class NativeRevokeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly credentials: NativeCredentialStore,
    private readonly issuer: NativeCredentialIssuer,
    private readonly boundProofs: NativeBoundProofService,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async revoke(
    request: unknown,
    dpopProof?: string,
  ): Promise<RevokeSuccess | OauthFailure> {
    if (!this.authEpoch.nativeEnabled()) {
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.UNAUTHORIZED_CLIENT,
        ErrorCode.NATIVE_AUTH_DISABLED,
      );
    }
    const body = readStringFields(request, REVOKE_REQUEST_FIELDS);
    if (!body) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    if (body.client_secret) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_CLIENT);
    }
    const token = body.token?.trim() ?? '';
    if (!token) {
      return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
    }
    const now = this.clock.now();
    let refusalContext: ProofEventContext | undefined;
    try {
      return await this.unitOfWork.run(async (db) => {
        const credential = await this.credentials.findPresentedCredential(
          db,
          hashToken(token),
        );
        if (
          !credential ||
          (body.client_id && body.client_id !== credential.clientId)
        ) {
          return { ok: true };
        }
        const session = await this.credentials.findFamilySession(
          db,
          credential.sessionId,
        );
        const binding = resolveNativeBoundThumbprint(
          session?.proofKeyThumbprint ?? undefined,
          credential.proofKeyThumbprint ?? undefined,
        );
        if (binding.inconsistent) {
          const context = this.proofEventContext(credential, session);
          refusalContext = context;
          await this.boundProofs.recordRefusal(
            db,
            context,
            NATIVE_DPOP_FAILURE_REASON.CONFIGURATION_INVALID,
          );
          return this.invalidProof(
            NATIVE_DPOP_FAILURE_REASON.CONFIGURATION_INVALID,
          );
        }
        if (binding.thumbprint) {
          const context = this.proofEventContext(credential, session);
          refusalContext = context;
          const verification = this.boundProofs.verify(
            dpopProof,
            token,
            binding.thumbprint,
            NATIVE_DPOP_REVOKE_PATH,
            now,
          );
          if (!verification.result.ok) {
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
          await this.boundProofs.reserve(db, verification.result.jti, now);
        }
        await this.issuer.revokeFamily(
          db,
          credential.familyId,
          credential.sessionId,
          now,
          SECURITY_EVENT_ACTION.NATIVE_CLIENT_REVOKED,
        );
        return { ok: true };
      });
    } catch (error) {
      if (isNativeProofIdReplay(error) && refusalContext) {
        await this.boundProofs.recordRefusal(
          undefined,
          refusalContext,
          NATIVE_DPOP_FAILURE_REASON.PROOF_REPLAYED,
        );
        return this.invalidProof(NATIVE_DPOP_FAILURE_REASON.PROOF_REPLAYED);
      }
      throw storeFailureCause(error);
    }
  }

  private proofEventContext(
    credential: StoredNativeCredential,
    session: NativeFamilySession | null,
  ): ProofEventContext {
    return {
      ...(session ? { targetUserId: session.userId } : {}),
      sessionId: credential.sessionId,
      clientId: credential.clientId,
    };
  }

  private invalidProof(reason: string): OauthFailure {
    return oauthFailure(
      HttpStatus.BAD_REQUEST,
      OAUTH_ERROR.INVALID_DPOP_PROOF,
      reason,
    );
  }
}
