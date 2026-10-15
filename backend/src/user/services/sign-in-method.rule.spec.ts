import type { HeldSignInMethods } from '../stores/sign-in-method.store';
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type'; // feature:email-code
import {
  emailCodeOffered, // feature:email-code
  SignInSwitches,
  WAY_IN_SURFACE,
  WayInSurface,
  waysInBesidesPasskeys,
} from './sign-in-method.rule';

function held(overrides: Partial<HeldSignInMethods> = {}): HeldSignInMethods {
  return {
    emailSignIn: true,
    hasPassword: false,
    linkedProviders: [],
    passkeys: 0, // feature:passkeys
    ...overrides,
  };
}

function switches(overrides: Partial<SignInSwitches> = {}): SignInSwitches {
  return {
    password: false,
    magicLink: false,
    emailCode: false, // feature:email-code
    ...overrides,
  };
}

function onEverySurface(
  account: HeldSignInMethods,
  offered: SignInSwitches,
): Record<WayInSurface, number> {
  return {
    any: waysInBesidesPasskeys(account, offered, WAY_IN_SURFACE.ANY),
    browser: waysInBesidesPasskeys(account, offered, WAY_IN_SURFACE.BROWSER),
    native: waysInBesidesPasskeys(account, offered, WAY_IN_SURFACE.NATIVE),
  };
}

describe('ways into an account besides its passkeys', () => {
  // feature:email-code:start
  it('counts email code for a code-only account everywhere but the browser', () => {
    expect(onEverySurface(held(), switches({ emailCode: true }))).toEqual({
      any: 1,
      browser: 0,
      native: 1,
    });
  });
  // feature:email-code:end

  it('counts nothing for a code-only account while email code is off', () => {
    expect(onEverySurface(held(), switches())).toEqual({
      any: 0,
      browser: 0,
      native: 0,
    });
  });

  it('counts magic link on every surface, as before email code', () => {
    expect(onEverySurface(held(), switches({ magicLink: true }))).toEqual({
      any: 1,
      browser: 1,
      native: 1,
    });
  });

  // feature:email-code:start
  it('adds email code to a password, a provider and magic link outside the browser', () => {
    const account = held({ hasPassword: true, linkedProviders: ['google'] });
    const everything = switches({
      password: true,
      magicLink: true,
      emailCode: true,
    });

    expect(onEverySurface(account, everything)).toEqual({
      any: 4,
      browser: 3,
      native: 4,
    });
  });
  // feature:email-code:end
});

// feature:email-code:start
function application(
  signIn: NativeApplicationConfiguration['signIn'],
): NativeApplicationConfiguration {
  return {
    clientId: 'mobile',
    displayName: 'Mobile',
    redirectUris: ['myapp://callback'],
    allowedScopes: ['api'],
    signIn,
  };
}

const OFFERING = application({ emailCode: true });
const NOT_OFFERING = application({ emailLink: true });

describe('whether anyone can sign in by emailed code', () => {
  it.each([
    ['on with an application that offers it', true, true, [OFFERING], true],
    ['off while the setting is off', false, true, [OFFERING], false],
    ['off while native sign-in is off', true, false, [OFFERING], false],
    ['off when no application offers it', true, true, [NOT_OFFERING], false],
  ])('is %s', (_case, emailCodeEnabled, nativeEnabled, apps, offered) => {
    expect(
      emailCodeOffered({
        emailCodeEnabled,
        nativeEnabled,
        nativeApplications: apps,
      }),
    ).toBe(offered);
  });

  it('leaves a code-only account no way in besides its last passkey when no application offers the code', () => {
    const offered = emailCodeOffered({
      emailCodeEnabled: true,
      nativeEnabled: true,
      nativeApplications: [NOT_OFFERING],
    });

    expect(
      waysInBesidesPasskeys(
        held(),
        switches({ emailCode: offered }),
        WAY_IN_SURFACE.ANY,
      ),
    ).toBe(0);
  });
});
// feature:email-code:end
