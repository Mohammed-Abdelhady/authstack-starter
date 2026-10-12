import { ApplicationAccessStore } from '../../../../src/session/applications/application-access.store';
import { ApplicationRegistryStore } from '../../../../src/session/applications/application-registry.store';
import { AuthorityContractHarness } from '../authority-contract/authority-contract-harness';

export interface StoredApplication {
  clientId: string;
  environment: string;
  displayName: string;
  platform: string;
  clientType: string;
  enabled: boolean;
  redirectUris: string[];
  allowedOrigins: string[];
  audiences: string[];
  allowedScopes: string[];
  absoluteLifetimeMs: number;
  idleLifetimeMs: number;
  sessionVersion: number;
}

export interface StoredAccessGrant {
  id: string;
  allowed: boolean;
  sessionVersion: number;
}

/**
 * What one database gives the shared cases: the two adapters under test, and
 * plain reads and writes of stored state that go around them. Sign-in,
 * validation, the clock, events and reset come from the session harness on the
 * same database.
 */
export interface ApplicationsContractHarness {
  readonly authority: AuthorityContractHarness;
  readonly registryStore: ApplicationRegistryStore;
  readonly accessStore: ApplicationAccessStore;
  /** Every stored application, by environment and then client id. */
  storedApplications(): Promise<StoredApplication[]>;
  seedStoredApplication(application: StoredApplication): Promise<void>;
  grant(userId: string, clientId: string): Promise<StoredAccessGrant | null>;
  /** A well-formed id that names no grant. */
  absentGrantId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignGrantId(): string;
}
