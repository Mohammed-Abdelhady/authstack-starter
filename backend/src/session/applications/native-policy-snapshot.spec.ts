import type { NativeApplicationConfiguration } from '../../config/types/native-application.type';
import { nativePolicyChanged } from './native-policy-snapshot';
import type { StoredRegistration } from './application-registry.store';

const APPLICATION: NativeApplicationConfiguration = {
  clientId: 'app',
  displayName: 'App',
  redirectUris: ['https://app.example.test/callback'],
  allowedScopes: ['api'],
};
const STORED: StoredRegistration = {
  clientId: 'app',
  platform: 'native',
  clientType: 'public',
  enabled: true,
  redirectUris: APPLICATION.redirectUris,
  allowedScopes: APPLICATION.allowedScopes,
  signUp: 'open',
  policyVersion: 0,
};

describe('native policy reconciliation', () => {
  it('preserves legacy version zero and unchanged configuration', () => {
    expect(nativePolicyChanged(undefined, APPLICATION)).toBe(false);
    expect(nativePolicyChanged(STORED, APPLICATION)).toBe(false);
    expect(
      nativePolicyChanged(
        { ...STORED, signInMethods: { password: false } },
        { ...APPLICATION, signIn: { password: false } },
      ),
    ).toBe(false);
  });

  it.each<Partial<NativeApplicationConfiguration>>([
    { signUp: 'closed' },
    { audience: 'customer' },
    { firstParty: true },
    { allowedScopes: ['other'] },
    { signIn: { password: false } },
    { signIn: { rpId: 'native.example.test' } },
    { signIn: { origins: ['https://native.example.test'] } },
  ])(
    'ends older policy sessions when authorization configuration changes: %s',
    (change) => {
      expect(nativePolicyChanged(STORED, { ...APPLICATION, ...change })).toBe(
        true,
      );
    },
  );
});
