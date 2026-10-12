import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { IssuanceApplication } from '../issuance/browser-issuance.store';

/** A registered application as the server reads it to decide authority. */
export interface RegisteredApplication extends IssuanceApplication {
  allowedOrigins: string[];
}

/**
 * A registered application with what an authorization request reads beyond
 * authority: its client type, its redirect addresses and the name people see.
 */
export interface RegisteredClient extends RegisteredApplication {
  clientType: string;
  redirectUris: string[];
  displayName: string;
}

/** What a reconciliation needs to know of an application already stored. */
export interface StoredRegistration {
  clientId: string;
  platform: string;
  clientType: string;
  enabled: boolean;
  redirectUris: string[];
}

export interface ApplicationPolicyValues {
  absoluteLifetimeMs: number;
  idleLifetimeMs: number;
}

export interface FirstPartyRegistration {
  clientId: string;
  environment: string;
  displayName: string;
  platform: string;
  clientType: string;
  allowedOrigins: string[];
  policy: ApplicationPolicyValues;
  /** Written only when the application is created. */
  initialAudiences: string[];
  initialScopes: string[];
}

export interface NativeRegistration {
  clientId: string;
  environment: string;
  displayName: string;
  redirectUris: string[];
  allowedScopes: string[];
  audiences: string[];
  policy: ApplicationPolicyValues;
  /** The change must end the application's sessions: its version advances. */
  endsSessions: boolean;
}

export interface FirstPartyKey {
  clientId: string;
  platform: string;
}

/** The fields sign-in and validation read, without what only the registry reads. */
export function issuanceApplicationOf(
  application: RegisteredApplication,
): IssuanceApplication {
  return {
    clientId: application.clientId,
    platform: application.platform,
    enabled: application.enabled,
    sessionVersion: application.sessionVersion,
    allowedScopes: application.allowedScopes,
    policy: application.policy,
  };
}

/**
 * What the application registry needs from a database. Applications are named
 * by client id within one environment.
 *
 * Two kinds of read are kept apart. A committed authority read has no unit of
 * work in its signature: it answers from the primary and holds every change
 * that had returned before it started. A read inside a unit of work sees what
 * that unit of work sees.
 *
 * `lookUpClient` is neither. It is one plain read that may miss a change that
 * returned just before it, so nothing that issues or keeps a session may rest
 * on it alone: the unit of work that issues reads the client again.
 *
 * A reconciliation takes the environment's registry at `takeRegistrations`:
 * once it has returned, no other reconciliation of that environment can store
 * or disable an application until this unit of work ends. An adapter may take
 * it later, at this unit of work's first write. A second reconciliation that
 * reaches a taken registry is refused at once with a retryable abort. It does
 * not wait.
 */
export abstract class ApplicationRegistryStore {
  abstract readCommittedApplication(
    environment: string,
    clientId: string,
  ): Promise<RegisteredApplication | null>;

  abstract readCommittedApplications(
    environment: string,
    clientIds: string[],
  ): Promise<RegisteredApplication[]>;

  abstract findApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<RegisteredApplication | null>;

  abstract findApplications(
    unitOfWork: UnitOfWork,
    environment: string,
    clientIds: string[],
  ): Promise<RegisteredApplication[]>;

  /** A plain read of the client, enabled or not. Not an authority read. */
  abstract lookUpClient(
    environment: string,
    clientId: string,
  ): Promise<RegisteredClient | null>;

  /** The client, enabled or not, as the unit of work sees it. */
  abstract findClient(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<RegisteredClient | null>;

  /**
   * Creates the application, or brings its configured fields up to date. An
   * application that exists keeps its enabled flag, versions, redirect
   * addresses, audiences and scopes. Commits by itself.
   */
  abstract registerFirstParty(
    registration: FirstPartyRegistration,
  ): Promise<void>;

  /** Adds the origin to each named application that lacks it. Commits by itself. */
  abstract allowOrigin(
    environment: string,
    applications: FirstPartyKey[],
    origin: string,
  ): Promise<void>;

  /** Takes the registry and reads the stored applications among `clientIds`. */
  abstract takeRegistrations(
    unitOfWork: UnitOfWork,
    environment: string,
    clientIds: string[],
  ): Promise<StoredRegistration[]>;

  /**
   * Creates a public native application, or replaces the configured fields of
   * the one stored, enabled. The caller has read the client id in this unit of
   * work and found it free or a public native application's. If it belongs to
   * another kind of application by now, nothing is written and the unit of
   * work is refused with a retryable abort: the rerun reads it again.
   */
  abstract storeNativeRegistration(
    unitOfWork: UnitOfWork,
    registration: NativeRegistration,
  ): Promise<void>;

  /**
   * Disables every enabled native application of the environment that is not
   * among `keptClientIds`, and advances the version of each one it disables.
   */
  abstract disableNativeApplicationsExcept(
    unitOfWork: UnitOfWork,
    environment: string,
    keptClientIds: string[],
  ): Promise<void>;
}
