import { HttpStatus, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_RETRY_WINDOW_MS,
} from '../../constants/session-policy';
import {
  IssuanceAccount,
  IssuanceApplication,
  IssuanceGrant,
} from '../../issuance/browser-issuance.store';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  NativeFamilySession,
  StoredNativeCredential,
} from '../credentials/native-credential.store';
import {
  NativeRotationStore,
  REPLACEMENT_LINK,
  RETRY_CLAIM,
  SUCCESSOR_REVOCATION,
  UnusedSuccessor,
} from '../credentials/native-rotation.store';
import { NativeSecurityEvents } from '../credentials/native-security-events';
import { NativeCredentialIssuer } from '../token/native-credential.issuer';
import {
  ClientMeta,
  OAUTH_ERROR,
  OauthFailure,
  TokenSuccess,
  oauthFailure,
} from '../oauth/native-oauth.types';
import type { NativeDpopProofResult } from '../proof/native-dpop-proof';

export interface NativeBoundRetryInput {
  unitOfWork: UnitOfWork;
  presented: StoredNativeCredential;
  session: NativeFamilySession;
  account: IssuanceAccount;
  application: IssuanceApplication;
  grant: IssuanceGrant;
  meta: ClientMeta;
  now: Date;
  thumbprint: string;
  proof: Extract<NativeDpopProofResult, { ok: true }>;
}

@Injectable()
export class NativeBoundRetryService {
  constructor(
    private readonly rotations: NativeRotationStore,
    private readonly issuer: NativeCredentialIssuer,
    private readonly events: NativeSecurityEvents,
  ) {}

  async retryOrReplay(
    input: NativeBoundRetryInput,
  ): Promise<TokenSuccess | OauthFailure> {
    const { presented, now, unitOfWork } = input;
    if (!this.insideRetryWindow(presented, now)) {
      return this.replay(input);
    }
    const successor = await this.findUnusedSuccessor(input);
    if (!successor) {
      return this.replay(input);
    }
    const claimed = await this.rotations.claimRetry(unitOfWork, presented.id, {
      now,
      until: new Date(now.getTime() + NATIVE_DPOP_RETRY_WINDOW_MS),
    });
    if (claimed !== RETRY_CLAIM.CLAIMED) {
      return oauthFailure(
        HttpStatus.BAD_REQUEST,
        OAUTH_ERROR.INVALID_DPOP_PROOF,
        NATIVE_DPOP_FAILURE_REASON.RETRY_IN_PROGRESS,
      );
    }
    const pairRevoked = await this.rotations.revokeUnusedSuccessor(unitOfWork, {
      accessId: successor.accessId,
      refreshId: successor.refreshId,
      now,
    });
    if (pairRevoked !== SUCCESSOR_REVOCATION.REVOKED) {
      return this.replay(input);
    }
    const replacement = await this.issuer.issuePair(unitOfWork, {
      account: input.account,
      application: input.application,
      grant: input.grant,
      context: {
        clientId: presented.clientId,
        requestedScopes: input.session.scopes,
        audience: input.session.audience,
        authenticationMethods: input.session.authenticationMethods,
      },
      meta: input.meta,
      now,
      generation: successor.generation,
      existing: input.session,
      familyId: presented.familyId,
      proofKeyThumbprint: input.thumbprint,
    });
    const linked = await this.rotations.linkReplacement(
      unitOfWork,
      presented.id,
      {
        accessHash: hashToken(replacement.accessToken),
        refreshHash: hashToken(replacement.refreshToken),
        now,
      },
    );
    if (linked !== REPLACEMENT_LINK.LINKED) {
      return this.replay(input);
    }
    await this.events.record(unitOfWork, {
      targetUserId: input.account.id,
      clientId: presented.clientId,
      sessionId: input.session.id,
      action: SECURITY_EVENT_ACTION.NATIVE_DPOP_BOUND_RETRY,
    });
    return replacement;
  }

  private insideRetryWindow(
    presented: StoredNativeCredential,
    now: Date,
  ): boolean {
    const consumedAt = presented.consumedAt?.getTime();
    return (
      presented.expiresAt.getTime() > now.getTime() &&
      consumedAt !== undefined &&
      consumedAt <= now.getTime() &&
      now.getTime() - consumedAt < NATIVE_DPOP_RETRY_WINDOW_MS
    );
  }

  private async findUnusedSuccessor(
    input: NativeBoundRetryInput,
  ): Promise<UnusedSuccessor | null> {
    const { presented } = input;
    if (!presented.successorAccessHash || !presented.successorRefreshHash) {
      return null;
    }
    return this.rotations.findUnusedSuccessor(input.unitOfWork, {
      accessHash: presented.successorAccessHash,
      refreshHash: presented.successorRefreshHash,
      familyId: presented.familyId,
      sessionId: presented.sessionId,
      clientId: presented.clientId,
      generation: presented.generation,
    });
  }

  private async replay(input: NativeBoundRetryInput): Promise<OauthFailure> {
    await this.issuer.revokeFamily(
      input.unitOfWork,
      input.presented.familyId,
      input.presented.sessionId,
      input.now,
      SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
    );
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
  }
}
