import { Injectable } from '@nestjs/common';
import { SESSION_LAST_USED_UPDATE_INTERVAL_MS } from '../../common/constants/session';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import { Clock } from '../../common/services/clock';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../constants/credential-purpose';
import { AUTH_SCHEMA_VERSION } from '../constants/session-policy';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';
import {
  currentSessionDeadlines,
  EffectiveSessionDeadlines,
  isValidDate,
} from '../utils/authority/session-authority-rule';
import { hashToken } from '../utils/hashing/token-hash';
import { addMs, capIdleByAbsolute } from '../utils/session/session-deadline';
import {
  AuthorityApplication,
  AuthorityApplications,
} from './authority-applications';
import {
  AuthorityAccount,
  AuthorityGrant,
  IDLE_EXTENSION,
  SessionAuthorityStore,
  StoredSession,
} from './session-authority.store';

/** A session that holds authority now, and the account it belongs to. */
export interface ValidatedSession {
  session: StoredSession;
  account: AuthorityAccount;
  /** Whether this validation moved the idle deadline. */
  extended: boolean;
}

/**
 * Decides whether a session holds authority, from committed authority reads
 * alone. It opens no unit of work: each fact is read fresh, and the one write,
 * the idle extension, is guarded by the store.
 */
@Injectable()
export class SessionValidator {
  constructor(
    private readonly store: SessionAuthorityStore,
    private readonly applications: AuthorityApplications,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async validateByToken(
    token: string,
    extendIdle: boolean,
  ): Promise<ValidatedSession | null> {
    try {
      const session = await this.store.readCommittedSessionByTokenHash(
        hashToken(token),
      );
      return await this.authorize(
        session,
        extendIdle,
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
      );
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  async validateById(
    sessionId: string,
    extendIdle: boolean,
  ): Promise<ValidatedSession | null> {
    try {
      const session = await this.store.readCommittedSessionById(sessionId);
      return await this.authorize(
        session,
        extendIdle,
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      );
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  async listActive(userId: string): Promise<StoredSession[]> {
    try {
      const now = this.clock.now();
      const account = await this.store.readCommittedAccount(userId);
      if (!account || account.isDeleted) {
        return [];
      }
      const authEpoch = this.authEpoch.current();
      const candidates = await this.store.listSessionCandidates({
        userId,
        now,
        userVersion: account.sessionVersion,
        authEpoch,
        purposes: [
          CREDENTIAL_PURPOSE.BROWSER_SESSION,
          CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        ],
      });
      const clientIds = [
        ...new Set(candidates.map((session) => session.clientId)),
      ];
      const [applications, grants] = await Promise.all([
        this.applications.findByClientIds(clientIds),
        clientIds.length === 0
          ? Promise.resolve<AuthorityGrant[]>([])
          : this.store.readCommittedGrants(userId, clientIds),
      ]);
      const applicationByClientId = new Map<string, AuthorityApplication>();
      for (const application of applications) {
        applicationByClientId.set(application.clientId, application);
      }
      const grantByClientId = new Map<string, AuthorityGrant>();
      for (const grant of grants) {
        grantByClientId.set(grant.clientId, grant);
      }

      return candidates.filter(
        (candidate) =>
          currentSessionDeadlines(
            candidate,
            account,
            applicationByClientId.get(candidate.clientId),
            grantByClientId.get(candidate.clientId),
            now,
            authEpoch,
            candidate.credentialPurpose,
          ) !== null,
      );
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  async findById(sessionId: string): Promise<StoredSession | null> {
    try {
      return await this.store.findSessionById(sessionId);
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  async findByToken(token: string): Promise<StoredSession | null> {
    try {
      return await this.store.findSessionByTokenHash(hashToken(token));
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }

  private async authorize(
    session: StoredSession | null,
    extendIdle: boolean,
    purpose: CredentialPurpose,
  ): Promise<ValidatedSession | null> {
    if (!session || !hasRequiredAuthorityFields(session)) {
      return null;
    }
    if (
      !session.isValid ||
      session.revokedAt ||
      session.credentialPurpose !== purpose
    ) {
      return null;
    }
    if (session.authEpoch !== this.authEpoch.current()) {
      return null;
    }
    if (session.schemaVersion !== AUTH_SCHEMA_VERSION) {
      return null;
    }

    const account = await this.store.readCommittedAccount(session.userId);
    if (!account || account.isDeleted) {
      return null;
    }
    if (session.userVersion !== account.sessionVersion) {
      return null;
    }

    const application = await this.applications.findByClientId(
      session.clientId,
    );
    if (!application || !application.enabled) {
      return null;
    }
    if (session.clientVersion !== application.sessionVersion) {
      return null;
    }

    const grant = await this.store.readCommittedGrant(
      account.id,
      session.clientId,
    );
    if (!grant || !grant.allowed) {
      return null;
    }

    const now = this.clock.now();
    const deadlines = currentSessionDeadlines(
      session,
      account,
      application,
      grant,
      now,
      this.authEpoch.current(),
      purpose,
    );
    if (!deadlines) {
      return null;
    }

    const extended = extendIdle
      ? await this.maybeExtendIdle(
          session,
          now,
          deadlines,
          application.policy.idleLifetimeMs,
        )
      : false;
    return { session, account, extended };
  }

  /** Extends when activity is stale or the idle deadline is near. */
  private async maybeExtendIdle(
    session: StoredSession,
    now: Date,
    deadlines: EffectiveSessionDeadlines,
    idleLifetimeMs: number,
  ): Promise<boolean> {
    const lastActivity = session.lastActivityAt.getTime();
    const remainingIdle = deadlines.idle.getTime() - now.getTime();
    const stale =
      now.getTime() - lastActivity > SESSION_LAST_USED_UPDATE_INTERVAL_MS;
    if (!stale && remainingIdle > SESSION_LAST_USED_UPDATE_INTERVAL_MS) {
      return false;
    }

    const nextIdle = capIdleByAbsolute(
      addMs(now, idleLifetimeMs),
      deadlines.absolute,
    );
    const outcome = await this.store.extendIdle(session.id, {
      now,
      idleExpiresAt: nextIdle,
    });
    if (outcome !== IDLE_EXTENSION.EXTENDED) {
      return false;
    }
    session.lastUsedAt = now;
    session.lastActivityAt = now;
    session.idleExpiresAt = nextIdle;
    return true;
  }
}

/** A stored session written before a field existed holds no authority. */
function hasRequiredAuthorityFields(session: StoredSession): boolean {
  return Boolean(
    session.clientId &&
    isValidDate(session.authenticatedAt) &&
    isValidDate(session.expiresAt) &&
    isValidDate(session.idleExpiresAt) &&
    isValidDate(session.lastActivityAt) &&
    typeof session.userVersion === 'number' &&
    typeof session.clientVersion === 'number' &&
    typeof session.grantVersion === 'number' &&
    typeof session.authEpoch === 'number' &&
    typeof session.schemaVersion === 'number',
  );
}
