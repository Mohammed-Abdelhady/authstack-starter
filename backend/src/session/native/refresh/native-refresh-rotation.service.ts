import { HttpStatus, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
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
  REFRESH_CLAIM,
  SUCCESSOR_LINK,
} from '../credentials/native-rotation.store';
import { NativeCredentialIssuer } from '../token/native-credential.issuer';
import {
  ClientMeta,
  OAUTH_ERROR,
  OauthFailure,
  TokenSuccess,
  oauthFailure,
} from '../oauth/native-oauth.types';

export interface RefreshAuthority {
  session: NativeFamilySession;
  account: IssuanceAccount;
  application: IssuanceApplication;
  grant: IssuanceGrant;
}

@Injectable()
export class NativeRefreshRotationService {
  constructor(
    private readonly rotations: NativeRotationStore,
    private readonly issuer: NativeCredentialIssuer,
  ) {}

  async claimAndRotate(
    unitOfWork: UnitOfWork,
    presented: StoredNativeCredential,
    authority: RefreshAuthority,
    meta: ClientMeta,
    now: Date,
    thumbprint?: string,
  ): Promise<TokenSuccess | OauthFailure> {
    const claimed = await this.rotations.claimRefresh(
      unitOfWork,
      presented.id,
      now,
    );
    if (claimed !== REFRESH_CLAIM.CLAIMED) {
      return this.replay(unitOfWork, presented, now);
    }
    await this.rotations.retireAccessTokens(unitOfWork, {
      familyId: presented.familyId,
      sessionId: presented.sessionId,
      now,
    });
    const pair = await this.issuer.issuePair(unitOfWork, {
      account: authority.account,
      application: authority.application,
      grant: authority.grant,
      context: {
        clientId: presented.clientId,
        requestedScopes: authority.session.scopes,
        audience: authority.session.audience,
        authenticationMethods: authority.session.authenticationMethods,
      },
      meta,
      now,
      generation: presented.generation + 1,
      existing: authority.session,
      familyId: presented.familyId,
      proofKeyThumbprint: thumbprint,
    });
    if (thumbprint) {
      const linked = await this.rotations.linkSuccessors(
        unitOfWork,
        presented.id,
        {
          accessHash: hashToken(pair.accessToken),
          refreshHash: hashToken(pair.refreshToken),
        },
      );
      if (linked !== SUCCESSOR_LINK.LINKED) {
        return this.replay(unitOfWork, presented, now);
      }
    }
    return pair;
  }

  async replay(
    unitOfWork: UnitOfWork,
    presented: StoredNativeCredential,
    now: Date,
  ): Promise<OauthFailure> {
    await this.issuer.revokeFamily(
      unitOfWork,
      presented.familyId,
      presented.sessionId,
      now,
      SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
    );
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_GRANT);
  }
}
