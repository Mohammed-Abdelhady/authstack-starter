import { ConfigService } from '@nestjs/config';
import type {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type';
import { ApplicationRegistry } from './application-registry';
import type {
  ApplicationRegistryStore,
  NativeRegistration,
} from './application-registry.store';

const NATIVE_ENTRY = {
  displayName: 'Shop',
  redirectUris: ['https://links.example.test/return'],
  allowedScopes: ['api'],
};

function reconciledWith(
  applications: NativeApplicationConfiguration[],
  storedRequirement: string | null = null,
) {
  const stored: NativeRegistration[] = [];
  const store = partialMock<ApplicationRegistryStore>({
    findNativeRequiredPasskey: () => Promise.resolve(storedRequirement),
    takeRegistrations: () => Promise.resolve([]),
    storeNativeRegistration: (_work, registration) => {
      stored.push(registration);
      return Promise.resolve();
    },
    disableNativeApplicationsExcept: () => Promise.resolve(),
  });
  const runner = partialMock<UnitOfWorkRunner>({
    run: (work) => work(partialMock<UnitOfWork>()),
  });
  const config = new ConfigService({
    auth: { nativeEnabled: true, nativeApplications: applications },
  });
  const registry = new ApplicationRegistry(
    runner,
    store,
    new AuthEpochService(config),
  );
  return { registry, stored };
}

// Failure: account creation reads a native application as open and audience-less,
// so its accounts are stored without the audience start-up then refuses to serve.
describe('native application reconciliation', () => {
  it('stores the sign-up and audience each native entry configures', async () => {
    const { registry, stored } = reconciledWith([
      {
        ...NATIVE_ENTRY,
        clientId: 'shop',
        signUp: 'closed',
        audience: 'customer',
      },
      { ...NATIVE_ENTRY, clientId: 'plain' },
    ]);

    await registry.reconcileNativeApplications();

    expect(
      stored.map(({ clientId, signUp, accountAudience }) => ({
        clientId,
        signUp,
        accountAudience,
      })),
    ).toEqual([
      { clientId: 'shop', signUp: 'closed', accountAudience: 'customer' },
      { clientId: 'plain', signUp: 'open', accountAudience: null },
    ]);
  });
});

describe('a native application that requires a passkey', () => {
  it('persists a configured requirement and clears an omitted requirement', async () => {
    const { registry, stored } = reconciledWith([
      { ...NATIVE_ENTRY, clientId: 'plain' },
      { ...NATIVE_ENTRY, clientId: 'shop', requirePasskey: true },
    ]);
    await registry.reconcileNativeApplications();
    expect(
      stored.map(({ clientId, requirePasskey }) => ({
        clientId,
        requirePasskey,
      })),
    ).toEqual([
      { clientId: 'plain', requirePasskey: false },
      { clientId: 'shop', requirePasskey: true },
    ]);
  });
});
