import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../../../src/session/constants/client-ids';
import { CONTRACT_ENVIRONMENT } from '../issuance-contract/issuance-contract-harness';
import {
  type ApplicationsHarnessSource,
  OTHER_ENVIRONMENT,
  nativeApplication,
} from './applications-contract-support';

export function requiredPasskeyStartupCases(
  harness: ApplicationsHarnessSource,
): void {
  // Failure: a native requirement another version stored passes start-up, or a
  // browser application's own requirement keeps the server from starting.
  it('finds a stored native requirement of this environment only, enabled or not', async () => {
    const h = harness();
    const found = () =>
      h.registryStore.findNativeRequiredPasskey(CONTRACT_ENVIRONMENT);
    await h.seedStoredApplication(
      nativeApplication({
        clientId: 'web-required',
        platform: APPLICATION_PLATFORM.WEB,
        clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
        requirePasskey: true,
      }),
    );
    await h.seedStoredApplication(
      nativeApplication({
        clientId: 'admin-required',
        platform: APPLICATION_PLATFORM.ADMIN,
        clientType: APPLICATION_CLIENT_TYPE.CONFIDENTIAL,
        requirePasskey: true,
      }),
    );
    await h.seedStoredApplication(
      nativeApplication({
        clientId: 'foreign-required',
        environment: OTHER_ENVIRONMENT,
        requirePasskey: true,
      }),
    );
    await h.seedStoredApplication(nativeApplication({ requirePasskey: false }));
    expect(await found()).toBeNull();

    await h.seedStoredApplication(
      nativeApplication({
        clientId: 'retired-required',
        enabled: false,
        requirePasskey: true,
      }),
    );
    expect(await found()).toBe('retired-required');
  });
}
