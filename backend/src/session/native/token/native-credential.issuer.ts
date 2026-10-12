import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { parseUserAgent } from '../../../common/utils/parse-user-agent';
import { DEFAULT_API_AUDIENCE } from '../../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  AUTH_SCHEMA_VERSION,
  DEVICE_NAME_MAX_LENGTH,
  NATIVE_ACCESS_LIFETIME_MS,
  NATIVE_ACCESS_TOKEN_TYPE,
  NATIVE_INITIAL_IDLE_MS,
  USER_AGENT_MAX_LENGTH,
} from '../../constants/session-policy';
import {
  IssuanceAccount,
  IssuanceApplication,
  IssuanceGrant,
} from '../../issuance/browser-issuance.store';
import { boundLabel } from '../../utils/session/bound-label';
import { addMs, capIdleByAbsolute } from '../../utils/session/session-deadline';
import { hashToken, randomSecret } from '../../utils/hashing/token-hash';
import {
  NativeCredentialStore,
  NativeFamilySession,
} from '../credentials/native-credential.store';
import { NativeSecurityEvents } from '../credentials/native-security-events';
import { ClientMeta, TokenSuccess } from '../oauth/native-oauth.types';

export interface NativeGrantContext {
  clientId: string;
  requestedScopes: string[];
  audience?: string | null;
  authenticationMethods?: string[];
}

export interface NativePairRequest {
  account: IssuanceAccount;
  application: IssuanceApplication;
  grant: IssuanceGrant;
  context: NativeGrantContext;
  meta: ClientMeta;
  now: Date;
  generation: number;
  /** The family's session when the pair replaces an older one. */
  existing?: NativeFamilySession;
  familyId?: string;
  proofKeyThumbprint?: string;
}

@Injectable()
export class NativeCredentialIssuer {
  constructor(
    private readonly credentials: NativeCredentialStore,
    private readonly events: NativeSecurityEvents,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async issuePair(
    unitOfWork: UnitOfWork,
    request: NativePairRequest,
  ): Promise<TokenSuccess> {
    const { account, application, grant, context, meta, now, existing } =
      request;
    const familyId = request.familyId ?? randomSecret();
    const proofKeyThumbprint = request.proofKeyThumbprint;
    const absoluteExpiresAt = existing
      ? existing.expiresAt
      : addMs(now, application.policy.absoluteLifetimeMs);
    const idleExpiresAt = existing
      ? existing.idleExpiresAt
      : capIdleByAbsolute(
          addMs(now, NATIVE_INITIAL_IDLE_MS),
          absoluteExpiresAt,
        );
    let sessionId = existing?.id;
    if (!sessionId) {
      const device = parseUserAgent(meta.userAgent);
      sessionId = await this.credentials.insertNativeSession(unitOfWork, {
        userId: account.id,
        tokenHash: hashToken(randomSecret()),
        userAgent:
          boundLabel(meta.userAgent, USER_AGENT_MAX_LENGTH) || 'native',
        device,
        deviceName:
          boundLabel(device.name ?? '', DEVICE_NAME_MAX_LENGTH) || undefined,
        ip: meta.ip || 'unknown',
        lastUsedAt: now,
        expiresAt: absoluteExpiresAt,
        schemaVersion: AUTH_SCHEMA_VERSION,
        authEpoch: this.authEpoch.current(),
        clientId: context.clientId,
        userVersion: account.sessionVersion,
        clientVersion: application.sessionVersion,
        grantVersion: grant.sessionVersion,
        scopes: context.requestedScopes,
        audience: context.audience || DEFAULT_API_AUDIENCE,
        authenticationMethods: context.authenticationMethods ?? [],
        authenticatedAt: now,
        idleExpiresAt,
        lastActivityAt: now,
        credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        ...(proofKeyThumbprint ? { proofKeyThumbprint } : {}),
      });
      await this.events.record(unitOfWork, {
        targetUserId: account.id,
        clientId: context.clientId,
        sessionId,
        action: SECURITY_EVENT_ACTION.SESSION_ISSUED,
      });
    }
    const accessToken = randomSecret();
    const refreshToken = randomSecret();
    const accessExpiresAt = capIdleByAbsolute(
      addMs(now, NATIVE_ACCESS_LIFETIME_MS),
      absoluteExpiresAt,
    );
    await this.credentials.insertCredentialPair(unitOfWork, {
      sessionId,
      clientId: context.clientId,
      generation: request.generation,
      familyId,
      issuedAt: now,
      ...(proofKeyThumbprint ? { proofKeyThumbprint } : {}),
      access: { tokenHash: hashToken(accessToken), expiresAt: accessExpiresAt },
      refresh: {
        tokenHash: hashToken(refreshToken),
        expiresAt: absoluteExpiresAt,
      },
    });
    return {
      ok: true,
      accessToken,
      refreshToken,
      expiresIn: Math.floor((accessExpiresAt.getTime() - now.getTime()) / 1000),
      scope: context.requestedScopes.join(' '),
      tokenType: NATIVE_ACCESS_TOKEN_TYPE,
    };
  }

  /** Ends the family and records why, in the caller's unit of work. */
  async revokeFamily(
    unitOfWork: UnitOfWork,
    familyId: string,
    sessionId: string,
    now: Date,
    action: string,
  ): Promise<void> {
    const owner = await this.credentials.revokeFamily(unitOfWork, {
      familyId,
      sessionId,
      now,
      reason: action,
    });
    await this.events.record(unitOfWork, {
      targetUserId: owner?.userId,
      clientId: owner?.clientId,
      sessionId,
      action,
    });
  }
}
