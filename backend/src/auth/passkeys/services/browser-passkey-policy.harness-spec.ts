import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { WEB_CLIENT_ID } from '../../../session/constants/client-ids';
import type { PasskeyRelyingParty } from '../../contracts/types/passkey-relying-party';
import { BrowserPasskeyPolicy } from './browser-passkey-policy.service';

/** The web application's passkey policy as its stored policy would read. */
export function webPasskeyPolicy(
  relyingParty: PasskeyRelyingParty,
  requirePasskey = false,
): BrowserPasskeyPolicy {
  return partialMock<BrowserPasskeyPolicy>({
    of: () =>
      Promise.resolve({
        clientId: WEB_CLIENT_ID,
        relyingParty,
        requirePasskey,
      }),
  });
}
