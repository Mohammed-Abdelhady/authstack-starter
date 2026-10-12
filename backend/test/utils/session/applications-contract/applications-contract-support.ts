import { ConfigService } from '@nestjs/config';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { AuthEpochService } from '../../../../src/common/services/auth-epoch.service';
import type { NativeApplicationConfiguration } from '../../../../src/config/types/native-application.type';
import { ApplicationAccess } from '../../../../src/session/applications/application-access';
import { ApplicationRegistry } from '../../../../src/session/applications/application-registry';
import {
  CONTRACT_AUTH_EPOCH,
  CONTRACT_ENVIRONMENT,
} from '../issuance-contract/issuance-contract-harness';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import {
  ApplicationsContractHarness,
  StoredApplication,
} from './applications-contract-harness';

export type ApplicationsHarnessSource = () => ApplicationsContractHarness;

export const CLIENT_ORIGIN = 'https://app.example.test';
export const OTHER_ENVIRONMENT = 'staging';
export const MOBILE_CLIENT = 'configured-mobile';
export const MOBILE_REDIRECT = 'example-native://callback';

/** The native lifetimes, written out so a changed constant cannot agree with itself. */
const THIRTY_DAYS_MS = 2_592_000_000;
const SEVEN_DAYS_MS = 604_800_000;

export const MOBILE: NativeApplicationConfiguration = {
  clientId: MOBILE_CLIENT,
  displayName: 'Configured Mobile',
  redirectUris: [MOBILE_REDIRECT],
  allowedScopes: ['api'],
};

/** What a reconciliation of `MOBILE` stores when nothing was stored before. */
export const MOBILE_STORED: StoredApplication = {
  clientId: 'configured-mobile',
  environment: 'test',
  displayName: 'Configured Mobile',
  platform: 'native',
  clientType: 'public',
  enabled: true,
  redirectUris: ['example-native://callback'],
  allowedOrigins: [],
  audiences: ['api'],
  allowedScopes: ['api'],
  absoluteLifetimeMs: THIRTY_DAYS_MS,
  idleLifetimeMs: SEVEN_DAYS_MS,
  sessionVersion: 0,
};

export interface RegistryConfiguration {
  nativeEnabled?: boolean;
  nativeApplications?: NativeApplicationConfiguration[];
}

function authEpochFor(configuration: RegistryConfiguration): AuthEpochService {
  return new AuthEpochService(
    new ConfigService({
      auth: {
        epoch: CONTRACT_AUTH_EPOCH,
        nativeEnabled: configuration.nativeEnabled ?? true,
        nativeApplications: configuration.nativeApplications ?? [],
      },
      server: { nodeEnv: CONTRACT_ENVIRONMENT },
      cors: { clientUrl: `${CLIENT_ORIGIN}/welcome` },
    }),
  );
}

/** The real registry on this database's store and runner, with this configuration. */
export function registryOn(
  harness: ApplicationsContractHarness,
  configuration: RegistryConfiguration = {},
  pause: RerunPause = rerunAtOnce,
): ApplicationRegistry {
  return new ApplicationRegistry(
    harness.authority.issuance.runner(pause),
    harness.registryStore,
    authEpochFor(configuration),
  );
}

/** Reconciles the stored native applications with the given list. */
export function reconcile(
  harness: ApplicationsContractHarness,
  nativeApplications: NativeApplicationConfiguration[],
  pause: RerunPause = rerunAtOnce,
): Promise<void> {
  return registryOn(
    harness,
    { nativeApplications },
    pause,
  ).reconcileNativeApplications();
}

/** The real access service on this database's store and runner. */
export function accessOn(
  harness: ApplicationsContractHarness,
  pause: RerunPause = rerunAtOnce,
): ApplicationAccess {
  return new ApplicationAccess(
    harness.authority.issuance.runner(pause),
    harness.accessStore,
    authEpochFor({}),
  );
}

export function nativeApplication(
  overrides: Partial<StoredApplication> = {},
): StoredApplication {
  return { ...MOBILE_STORED, ...overrides };
}

/** The stored native applications, as the fields a reconciliation decides. */
export async function storedNatives(
  harness: ApplicationsContractHarness,
): Promise<
  Array<{
    clientId: string;
    environment: string;
    enabled: boolean;
    sessionVersion: number;
  }>
> {
  return (await harness.storedApplications())
    .filter(({ platform }) => platform === 'native')
    .map(({ clientId, environment, enabled, sessionVersion }) => ({
      clientId,
      environment,
      enabled,
      sessionVersion,
    }));
}

export async function storedApplication(
  harness: ApplicationsContractHarness,
  clientId: string,
  environment = CONTRACT_ENVIRONMENT,
): Promise<StoredApplication | undefined> {
  return (await harness.storedApplications()).find(
    (application) =>
      application.clientId === clientId &&
      application.environment === environment,
  );
}

/** Actions of the events the cases caused, oldest first, for one client. */
export async function eventsFor(
  harness: ApplicationsContractHarness,
  clientId: string,
): Promise<Array<{ action: string; reasonCode: string | null }>> {
  return (await harness.authority.events())
    .filter((event) => event.clientId === clientId)
    .filter(({ action }) => action !== 'session_issued')
    .map(({ action, reasonCode }) => ({ action, reasonCode }));
}
