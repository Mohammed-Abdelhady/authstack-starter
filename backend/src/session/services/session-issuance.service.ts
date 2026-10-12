import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import { parseUserAgent } from '../../common/utils/parse-user-agent';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
  WEB_CLIENT_ID,
} from '../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import {
  AUTH_SCHEMA_VERSION,
  DEVICE_NAME_MAX_LENGTH,
  MAX_ADMIN_SESSIONS_PER_USER,
  MAX_SESSIONS_PER_USER,
  NATIVE_INITIAL_IDLE_MS,
  USER_AGENT_MAX_LENGTH,
} from '../constants/session-policy';
import {
  ACCOUNT_ISSUANCE_MARK,
  BrowserIssuanceStore,
  IssuanceAccount,
  IssuanceApplication,
  IssuanceGrant,
} from '../issuance/browser-issuance.store';
import { IssuanceApplications } from '../issuance/issuance-applications';
import { boundLabel } from '../utils/session/bound-label';
import { addMs, capIdleByAbsolute } from '../utils/session/session-deadline';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';
import { hashToken, randomSecret } from '../utils/hashing/token-hash';
import { currentSessionDeadlines } from '../utils/authority/session-authority-rule';

export interface IssuedBrowserSession {
  sessionToken: string;
  csrfToken: string;
}

@Injectable()
export class SessionIssuanceService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly store: BrowserIssuanceStore,
    private readonly applications: IssuanceApplications,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async createBrowserSession(
    userId: string,
    userAgent: string,
    ip: string,
    clientId = WEB_CLIENT_ID,
  ): Promise<IssuedBrowserSession> {
    try {
      return await this.unitOfWork.run((unitOfWork) =>
        this.issue(unitOfWork, userId, userAgent, ip, clientId),
      );
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  private async issue(
    unitOfWork: UnitOfWork,
    userId: string,
    userAgent: string,
    ip: string,
    clientId: string,
  ): Promise<IssuedBrowserSession> {
    const account = await this.store.readAccountForIssuance(unitOfWork, userId);
    if (!account || account.isDeleted) {
      throw accountNotFound();
    }

    const application = await this.applications.requireEnabled(
      unitOfWork,
      clientId,
    );
    this.assertNativeAllowed(application);

    const marked = await this.store.markAccountIssuance(unitOfWork, account.id);
    if (marked !== ACCOUNT_ISSUANCE_MARK.MARKED) {
      throw accountNotFound();
    }

    const grant = await this.requireOrCreateGrant(
      unitOfWork,
      account.id,
      clientId,
      application,
    );
    await this.store.markGrantIssuance(unitOfWork, grant.id);

    const now = this.clock.now();
    await this.assertSessionLimit(unitOfWork, account, application, now);

    const token = randomSecret();
    const csrfToken = randomSecret();
    const absoluteExpiresAt = addMs(now, application.policy.absoluteLifetimeMs);
    const idleMs =
      application.platform === APPLICATION_PLATFORM.NATIVE
        ? NATIVE_INITIAL_IDLE_MS
        : application.policy.idleLifetimeMs;
    const idleExpiresAt = capIdleByAbsolute(
      addMs(now, idleMs),
      absoluteExpiresAt,
    );
    const device = parseUserAgent(userAgent);
    const boundedAgent =
      boundLabel(userAgent, USER_AGENT_MAX_LENGTH) || 'unknown';
    const deviceName = boundLabel(device.name, DEVICE_NAME_MAX_LENGTH);

    const sessionId = await this.store.insertBrowserSession(unitOfWork, {
      userId: account.id,
      tokenHash: hashToken(token),
      userAgent: boundedAgent,
      device,
      deviceName: deviceName || undefined,
      ip,
      lastUsedAt: now,
      expiresAt: absoluteExpiresAt,
      schemaVersion: AUTH_SCHEMA_VERSION,
      authEpoch: this.authEpoch.current(),
      clientId,
      userVersion: account.sessionVersion,
      clientVersion: application.sessionVersion,
      grantVersion: grant.sessionVersion,
      scopes: [DEFAULT_API_AUDIENCE],
      audience: DEFAULT_API_AUDIENCE,
      authenticationMethods: [],
      authenticatedAt: now,
      idleExpiresAt,
      lastActivityAt: now,
      credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
      browserGeneration: 1,
      csrfToken,
    });

    await this.store.appendSecurityEvent(unitOfWork, {
      targetUserId: account.id,
      clientId,
      sessionId,
      action: SECURITY_EVENT_ACTION.SESSION_ISSUED,
    });

    return { sessionToken: token, csrfToken };
  }

  private assertNativeAllowed(application: IssuanceApplication): void {
    if (application.platform !== APPLICATION_PLATFORM.NATIVE) {
      return;
    }
    if (!this.authEpoch.nativeEnabled()) {
      throw new AppException(
        ErrorCode.FEATURE_DISABLED,
        'Native session issuance is disabled',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async requireOrCreateGrant(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
    application: IssuanceApplication,
  ): Promise<IssuanceGrant> {
    const existing = await this.store.findGrant(unitOfWork, userId, clientId);
    if (existing && !existing.allowed) {
      throw grantBlocked();
    }
    if (existing) {
      return existing;
    }

    if (application.platform === APPLICATION_PLATFORM.NATIVE) {
      throw grantBlocked();
    }

    return this.store.createGrant(unitOfWork, {
      userId,
      clientId,
      allowedScopes: application.allowedScopes,
    });
  }

  async assertSessionLimit(
    unitOfWork: UnitOfWork,
    account: IssuanceAccount,
    application: IssuanceApplication,
    now: Date,
  ): Promise<void> {
    const authEpoch = this.authEpoch.current();
    const candidates = await this.store.listSessionCapCandidates(unitOfWork, {
      userId: account.id,
      userVersion: account.sessionVersion,
      authEpoch,
      now,
      purposes: [
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      ],
    });
    const activeSessions = candidates.filter(
      (candidate) =>
        currentSessionDeadlines(
          candidate.session,
          account,
          candidate.application,
          candidate.grant,
          now,
          authEpoch,
          candidate.session.credentialPurpose,
        ) !== null,
    );
    if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
      throw sessionLimitReached();
    }

    if (application.clientId !== ADMIN_CLIENT_ID) {
      return;
    }

    const adminCount = activeSessions.filter(
      (candidate) => candidate.session.clientId === ADMIN_CLIENT_ID,
    ).length;
    if (adminCount >= MAX_ADMIN_SESSIONS_PER_USER) {
      throw sessionLimitReached();
    }
  }
}

function accountNotFound(): AppException {
  return new AppException(
    ErrorCode.USER_NOT_FOUND,
    'User not found',
    HttpStatus.NOT_FOUND,
  );
}

function grantBlocked(): AppException {
  return new AppException(
    ErrorCode.GRANT_BLOCKED,
    'Application access is blocked for this account',
    HttpStatus.FORBIDDEN,
  );
}

function sessionLimitReached(): AppException {
  return new AppException(
    ErrorCode.SESSION_LIMIT_REACHED,
    'Session limit reached',
    HttpStatus.CONFLICT,
  );
}
