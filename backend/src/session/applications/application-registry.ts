import { Injectable } from '@nestjs/common';
import {
  runLeavingFailuresAsRaised,
  storeFailureCause,
} from '../../common/persistence/store-failure';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
  NATIVE_APPLICATIONS_CONFIG_VARIABLE,
  WEB_CLIENT_ID,
} from '../constants/client-ids';
import {
  ADMIN_ABSOLUTE_LIFETIME_MS,
  ADMIN_IDLE_LIFETIME_MS,
  NATIVE_ABSOLUTE_LIFETIME_MS,
  NATIVE_IDLE_LIFETIME_MS,
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../constants/session-policy';
import { requireEnabledApplication } from '../utils/authority/application-rule';
import {
  ApplicationRegistryStore,
  FirstPartyKey,
  RegisteredApplication,
  RegisteredClient,
  StoredRegistration,
} from './application-registry.store';

const FIRST_PARTY_APPLICATIONS: FirstPartyKey[] = [
  { clientId: WEB_CLIENT_ID, platform: APPLICATION_PLATFORM.WEB },
  { clientId: ADMIN_CLIENT_ID, platform: APPLICATION_PLATFORM.ADMIN },
];

/**
 * The applications that may sign people in: the web and admin applications the
 * server ships with, and the native ones its configuration lists.
 */
@Injectable()
export class ApplicationRegistry {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly store: ApplicationRegistryStore,
    private readonly authEpoch: AuthEpochService,
  ) {}

  /** Judged on a committed authority read. */
  async requireEnabled(clientId: string): Promise<RegisteredApplication> {
    return requireEnabledApplication(
      await this.store.readCommittedApplication(
        this.authEpoch.environment(),
        clientId,
      ),
    );
  }

  /** Judged on what the caller's unit of work sees. */
  async requireEnabledIn(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<RegisteredApplication> {
    return requireEnabledApplication(
      await this.store.findApplication(
        unitOfWork,
        this.authEpoch.environment(),
        clientId,
      ),
    );
  }

  findByClientId(clientId: string): Promise<RegisteredApplication | null> {
    return this.store.readCommittedApplication(
      this.authEpoch.environment(),
      clientId,
    );
  }

  async findByClientIds(clientIds: string[]): Promise<RegisteredApplication[]> {
    if (clientIds.length === 0) {
      return [];
    }
    return this.store.readCommittedApplications(
      this.authEpoch.environment(),
      clientIds,
    );
  }

  async findByClientIdsIn(
    unitOfWork: UnitOfWork,
    clientIds: string[],
  ): Promise<RegisteredApplication[]> {
    if (clientIds.length === 0) {
      return [];
    }
    return this.store.findApplications(
      unitOfWork,
      this.authEpoch.environment(),
      clientIds,
    );
  }

  /**
   * The client as an authorization request reads it, enabled or not, on a plain
   * read. It may be a moment old: a caller that issues reads it again inside
   * its unit of work.
   */
  lookUpClient(clientId: string): Promise<RegisteredClient | null> {
    return this.store.lookUpClient(this.authEpoch.environment(), clientId);
  }

  /** The client, enabled or not, as the caller's unit of work sees it. */
  findClientIn(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<RegisteredClient | null> {
    return this.store.findClient(
      unitOfWork,
      this.authEpoch.environment(),
      clientId,
    );
  }

  async seedFirstPartyApplications(): Promise<void> {
    const environment = this.authEpoch.environment();
    const initial = {
      environment,
      initialAudiences: [DEFAULT_API_AUDIENCE],
      initialScopes: [DEFAULT_API_AUDIENCE],
    };
    await asRaised(
      this.store.registerFirstParty({
        ...initial,
        clientId: WEB_CLIENT_ID,
        displayName: 'Web',
        platform: APPLICATION_PLATFORM.WEB,
        clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
        allowedOrigins: [this.clientOrigin()],
        policy: {
          absoluteLifetimeMs: WEB_ABSOLUTE_LIFETIME_MS,
          idleLifetimeMs: WEB_IDLE_LIFETIME_MS,
        },
      }),
    );
    await asRaised(
      this.store.registerFirstParty({
        ...initial,
        clientId: ADMIN_CLIENT_ID,
        displayName: 'Admin',
        platform: APPLICATION_PLATFORM.ADMIN,
        clientType: APPLICATION_CLIENT_TYPE.CONFIDENTIAL,
        allowedOrigins: [],
        policy: {
          absoluteLifetimeMs: ADMIN_ABSOLUTE_LIFETIME_MS,
          idleLifetimeMs: ADMIN_IDLE_LIFETIME_MS,
        },
      }),
    );
  }

  async ensureClientOriginAllowed(): Promise<void> {
    await asRaised(
      this.store.allowOrigin(
        this.authEpoch.environment(),
        FIRST_PARTY_APPLICATIONS,
        this.clientOrigin(),
      ),
    );
  }

  /**
   * Brings the stored native applications in line with the configured list, in
   * one unit of work: listed ones are created or updated and enabled, the rest
   * are disabled. Nothing is stored unless all of it is.
   */
  async reconcileNativeApplications(): Promise<void> {
    if (!this.authEpoch.nativeEnabled()) {
      return;
    }
    const environment = this.authEpoch.environment();
    const configured = this.authEpoch.nativeApplications();
    const clientIds = configured.map(({ clientId }) => clientId);

    await runLeavingFailuresAsRaised(this.unitOfWork, async (unitOfWork) => {
      const stored = new Map(
        (
          await this.store.takeRegistrations(unitOfWork, environment, clientIds)
        ).map((registration) => [registration.clientId, registration]),
      );
      for (const application of configured) {
        const found = stored.get(application.clientId);
        if (found && !isPublicNative(found)) {
          throw anotherKind(application.clientId);
        }
      }
      for (const application of configured) {
        await this.store.storeNativeRegistration(unitOfWork, {
          clientId: application.clientId,
          environment,
          displayName: application.displayName,
          redirectUris: application.redirectUris,
          allowedScopes: application.allowedScopes,
          audiences: [DEFAULT_API_AUDIENCE],
          policy: {
            absoluteLifetimeMs: NATIVE_ABSOLUTE_LIFETIME_MS,
            idleLifetimeMs: NATIVE_IDLE_LIFETIME_MS,
          },
          endsSessions: endsSessions(
            stored.get(application.clientId),
            application,
          ),
        });
      }
      await this.store.disableNativeApplicationsExcept(
        unitOfWork,
        environment,
        clientIds,
      );
    });
  }

  private clientOrigin(): string {
    return new URL(this.authEpoch.clientUrl()).origin;
  }
}

function isPublicNative(registration: StoredRegistration): boolean {
  return (
    registration.platform === APPLICATION_PLATFORM.NATIVE &&
    registration.clientType === APPLICATION_CLIENT_TYPE.PUBLIC
  );
}

/**
 * Sessions of a stored application end when it comes back from disabled, or
 * when a redirect address it had is no longer configured.
 */
function endsSessions(
  stored: StoredRegistration | undefined,
  configured: NativeApplicationConfiguration,
): boolean {
  if (!stored) {
    return false;
  }
  return (
    !stored.enabled ||
    stored.redirectUris.some((uri) => !configured.redirectUris.includes(uri))
  );
}

function anotherKind(clientId: string): Error {
  return new Error(
    `${NATIVE_APPLICATIONS_CONFIG_VARIABLE} entry ${JSON.stringify(clientId)}: client id belongs to an application of another kind.`,
  );
}

/** A start-up write never answered a database failure itself: it leaves as raised. */
async function asRaised<Result>(statement: Promise<Result>): Promise<Result> {
  try {
    return await statement;
  } catch (error) {
    throw storeFailureCause(error);
  }
}
