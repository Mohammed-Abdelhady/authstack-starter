import type {
  BrowserApplicationAdmission,
  BrowserIssuanceAdmission,
  AdmittedBrowserSessionRequest,
} from '../types/browser-application-admission';
import {
  assertNativeIssuanceAllowed,
  assertBrowserAdmissionIn,
  replaceEnrolmentsIn,
  recordCreationRefusal,
} from '../issuance/browser-admission';
import { SignInNoticeService } from '../notices/sign-in-notice.service';
import { sessionLimitsFor } from '../utils/session/session-limits';
import { assertPasskeySignIn } from '../utils/authority/passkey-sign-in';
import {
  ENROLMENT_LIFETIME_MS,
  ENROLMENT_TOKEN_PREFIX,
} from '../constants/enrolment';
import {
  accountNotFound,
  grantBlocked,
} from '../issuance/session-issuance-errors';
import type { AccountCreationMethod } from '../../auth/types/account-creation';
import { withAudienceRefusal } from '../issuance/audience-refusal';
import { EventRecorder } from '../../auth/contracts/event-recorder';
import { assertAudienceAdmission } from '../utils/authority/audience-admission';
import type { BrowserEvidence } from '../types/browser-evidence';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import { parseUserAgent } from '../../common/utils/parse-user-agent';
import {
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
} from '../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import {
  AUTH_SCHEMA_VERSION,
  DEVICE_NAME_MAX_LENGTH,
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
import { hashToken, randomSecret } from '../utils/hashing/token-hash';
import { assertSessionLimitIn } from '../issuance/session-limit';
import { EnrolmentStore } from '../enrolment/enrolment.store';

import type { IssuedBrowserSession } from '../types/issued-browser-session';
export type { IssuedBrowserSession } from '../types/issued-browser-session';

@Injectable()
export class SessionIssuanceService {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly store: BrowserIssuanceStore,
    private readonly applications: IssuanceApplications,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
    @Inject(EventRecorder)
    private readonly events: Pick<EventRecorder, 'recordOutsideUnitOfWork'>,
    private readonly enrolments: EnrolmentStore,
    @Optional() private readonly notices?: SignInNoticeService,
  ) {}

  async createBrowserSession(
    userId: string,
    userAgent: string,
    ip: string,
    clientId: string,
    evidence: BrowserEvidence = {
      authenticationMethods: [],
      userVerified: false,
    },
  ): Promise<IssuedBrowserSession> {
    return withAudienceRefusal(this.events, userId, clientId, () =>
      this.unitOfWork.run((unitOfWork) =>
        this.issue(unitOfWork, userId, userAgent, ip, clientId, evidence),
      ),
    );
  }

  /** Only invitation acceptance and passkey reset may call this trusted seam. */
  createEnrolmentSessionIn(
    work: UnitOfWork,
    userId: string,
    userAgent: string,
    ip: string,
    clientId: string,
  ): Promise<IssuedBrowserSession> {
    return this.issue(
      work,
      userId,
      userAgent,
      ip,
      clientId,
      { authenticationMethods: [], userVerified: false },
      CREDENTIAL_PURPOSE.ENROLMENT,
    );
  }

  createBrowserSessionIn(
    work: UnitOfWork,
    userId: string,
    userAgent: string,
    ip: string,
    clientId: string,
    evidence: BrowserEvidence,
  ): Promise<IssuedBrowserSession> {
    return this.issue(work, userId, userAgent, ip, clientId, evidence);
  }

  createBrowserSessionWithAdmission(
    request: AdmittedBrowserSessionRequest,
  ): Promise<IssuedBrowserSession> {
    return withAudienceRefusal(
      this.events,
      request.userId,
      request.clientId,
      () =>
        this.unitOfWork.run((work) =>
          this.createBrowserSessionWithAdmissionIn(work, request),
        ),
    );
  }

  createBrowserSessionWithAdmissionIn(
    work: UnitOfWork,
    request: AdmittedBrowserSessionRequest,
  ): Promise<IssuedBrowserSession> {
    return this.issue(
      work,
      request.userId,
      request.userAgent,
      request.ip,
      request.clientId,
      request.evidence,
      request.admit,
    );
  }

  assertAdmission(userId: string, clientId: string): Promise<void> {
    return withAudienceRefusal(this.events, userId, clientId, () =>
      this.unitOfWork.run(async (work) => {
        await this.assertAdmissionIn(work, userId, { clientId });
      }),
    );
  }

  async assertAdmissionIn(
    work: UnitOfWork,
    userId: string,
    request: {
      clientId: string;
      admit?: BrowserApplicationAdmission | undefined;
    },
  ): Promise<number> {
    return assertBrowserAdmissionIn(work, userId, {
      store: this.store,
      applications: this.applications,
      ...request,
    });
  }

  recordCreationRefusal(
    clientId: string,
    method: AccountCreationMethod,
  ): Promise<void> {
    return recordCreationRefusal(this.events, clientId, method);
  }

  private async issue(
    unitOfWork: UnitOfWork,
    userId: string,
    userAgent: string,
    ip: string,
    clientId: string,
    evidence: BrowserEvidence,
    admission: BrowserIssuanceAdmission = CREDENTIAL_PURPOSE.BROWSER_SESSION,
  ): Promise<IssuedBrowserSession> {
    const purpose =
      typeof admission === 'function'
        ? CREDENTIAL_PURPOSE.BROWSER_SESSION
        : admission;
    const account = await this.store.readAccountForIssuance(unitOfWork, userId);
    if (!account || account.isDeleted) {
      throw accountNotFound();
    }

    const application = await this.applications.requireEnabled(
      unitOfWork,
      clientId,
    );
    if (typeof admission === 'function') admission(application);
    assertNativeIssuanceAllowed(application, this.authEpoch);
    assertAudienceAdmission(
      account.accountAudience,
      application.accountAudience,
    );
    if (purpose === CREDENTIAL_PURPOSE.ENROLMENT) {
      if (application.platform === APPLICATION_PLATFORM.NATIVE) {
        throw grantBlocked();
      }
    } else {
      assertPasskeySignIn(application.requirePasskey, evidence);
    }

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
    if (purpose === CREDENTIAL_PURPOSE.ENROLMENT) {
      await replaceEnrolmentsIn(
        unitOfWork,
        { enrolments: this.enrolments, sessions: this.store },
        { userId: account.id, clientId, now },
      );
    }

    const token =
      purpose === CREDENTIAL_PURPOSE.ENROLMENT
        ? `${ENROLMENT_TOKEN_PREFIX}${randomSecret()}`
        : randomSecret();
    const csrfToken = randomSecret();
    const limits = sessionLimitsFor(application, false);
    const absoluteExpiresAt = addMs(
      now,
      purpose === CREDENTIAL_PURPOSE.ENROLMENT
        ? ENROLMENT_LIFETIME_MS
        : limits.absoluteLifetimeMs,
    );
    const idleMs =
      purpose === CREDENTIAL_PURPOSE.ENROLMENT
        ? ENROLMENT_LIFETIME_MS
        : limits.initialIdleLifetimeMs;
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
      authenticationMethods: [...evidence.authenticationMethods],
      userVerified: evidence.userVerified,
      policyVersion: application.policyVersion ?? 0,
      authenticatedAt: now,
      idleExpiresAt,
      lastActivityAt: now,
      credentialPurpose: purpose,
      browserGeneration: 1,
      csrfToken,
    });

    await this.store.appendSecurityEvent(unitOfWork, {
      targetUserId: account.id,
      clientId,
      sessionId,
      action: SECURITY_EVENT_ACTION.SESSION_ISSUED,
    });

    if (purpose !== CREDENTIAL_PURPOSE.ENROLMENT) {
      await this.notices?.record(unitOfWork, { userId, userAgent, at: now });
    }
    return { sessionToken: token, csrfToken };
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

  assertSessionLimit(
    unitOfWork: UnitOfWork,
    account: IssuanceAccount,
    application: IssuanceApplication,
    now: Date,
  ): Promise<void> {
    return assertSessionLimitIn(
      this.store,
      this.authEpoch.current(),
      unitOfWork,
      account,
      application,
      now,
    );
  }
}
