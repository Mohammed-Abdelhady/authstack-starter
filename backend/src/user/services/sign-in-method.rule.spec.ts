import type { HeldSignInMethods } from '../stores/sign-in-method.store';
// feature:email-code:start
import { ConfigService } from '@nestjs/config';
import { browserApplicationsForTest } from '../../common/testing/browser-applications.harness-spec';
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type';
import { AuthFeaturesService } from '../../auth/services/features/auth-features.service';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { SignInMethodStore } from '../stores/sign-in-method.store';
// feature:email-code:end
import {
  // feature:email-code:start
  emailCodeClientIds,
  EmailCodeApplications,
  EmailCodeDoor,
  EmailCodeGrants,
  SignInMethodRule,
  WAY_IN_OUTCOME,
  WaysLeft,
  // feature:email-code:end
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
  clientId: string,
  signIn: NativeApplicationConfiguration['signIn'],
): NativeApplicationConfiguration {
  return {
    clientId,
    displayName: 'Mobile',
    redirectUris: ['myapp://callback'],
    allowedScopes: ['api'],
    signIn,
  };
}

const OFFERING = application('mobile', { emailCode: true });
const NOT_OFFERING = application('mobile', { emailLink: true });

describe('which applications offer sign-in by emailed code', () => {
  it.each([
    ['the one that offers it', true, true, [OFFERING], ['mobile']],
    ['none while the setting is off', false, true, [OFFERING], []],
    ['none while native sign-in is off', true, false, [OFFERING], []],
    ['none when no application offers it', true, true, [NOT_OFFERING], []],
  ])('are %s', (_case, emailCodeEnabled, nativeEnabled, apps, offering) => {
    expect(
      emailCodeClientIds({
        emailCodeEnabled,
        nativeEnabled,
        nativeApplications: apps,
      }),
    ).toEqual(offering);
  });
});

class TestUnitOfWork extends UnitOfWork {}

/** One account's ways in, held or read alike. */
class OneAccount extends SignInMethodStore {
  constructor(private readonly account: HeldSignInMethods) {
    super();
  }

  holdForAccount(): Promise<HeldSignInMethods | null> {
    return Promise.resolve(this.account);
  }

  readForAccount(): Promise<HeldSignInMethods | null> {
    return Promise.resolve(this.account);
  }
}

const OPEN: EmailCodeDoor = {
  application: { enabled: true, platform: 'native', clientType: 'public' },
  grant: null,
};
const SWITCHED_OFF: EmailCodeDoor = {
  ...OPEN,
  application: { enabled: false, platform: 'native', clientType: 'public' },
};
const BLOCKED: EmailCodeDoor = { ...OPEN, grant: { allowed: false } };
const NEVER_STORED: EmailCodeDoor = { application: null, grant: null };
const NOT_PUBLIC_NATIVE: EmailCodeDoor = {
  ...OPEN,
  application: {
    enabled: true,
    platform: 'native',
    clientType: 'confidential',
  },
};

/** What the stores answer, by client id: inside a removal, and on a plain read. */
function readers(
  inRemoval: Record<string, EmailCodeDoor>,
  committed: Record<string, EmailCodeDoor> = inRemoval,
): { applications: EmailCodeApplications; grants: EmailCodeGrants } {
  const door = (doors: Record<string, EmailCodeDoor>, clientId: string) =>
    doors[clientId] ?? NEVER_STORED;
  return {
    applications: {
      findClientIn: (_unitOfWork, clientId) =>
        Promise.resolve(door(inRemoval, clientId).application),
      lookUpClient: (clientId) =>
        Promise.resolve(door(committed, clientId).application),
    },
    grants: {
      takeGrantForChange: (_unitOfWork, _userId, clientId) =>
        Promise.resolve(door(inRemoval, clientId).grant),
      readGrant: (_userId, clientId) =>
        Promise.resolve(door(committed, clientId).grant),
    },
  };
}

function ruleFor(
  account: HeldSignInMethods,
  offering: NativeApplicationConfiguration[],
  stores?: ReturnType<typeof readers>,
): SignInMethodRule {
  const features = new ConfigService({
    auth: { passwordEnabled: false },
    magicLink: { enabled: false },
  });
  return new SignInMethodRule(
    new OneAccount(account),
    new AuthFeaturesService(features, browserApplicationsForTest(features)),
    new ConfigService({
      emailCode: { enabled: true },
      auth: { nativeEnabled: true, nativeApplications: offering },
    }),
    stores?.applications,
    stores?.grants,
  );
}

/** Created to sign in by email, with no password and no provider. */
const CODE_ONLY = held();
/**
 * What removing a code-only account's last other way in leaves, its last
 * passkey or its only provider: every way besides it, the code included.
 */
const LEFT_BESIDES_IT: WaysLeft = (account, offered) =>
  waysInBesidesPasskeys(account, offered, WAY_IN_SURFACE.ANY);

describe('email code as a way in, as the stores let the account in', () => {
  it.each([
    ['open to it', OPEN, WAY_IN_OUTCOME.ANOTHER_LEFT],
    ['blocking its grant', BLOCKED, WAY_IN_OUTCOME.LAST],
    ['switched off', SWITCHED_OFF, WAY_IN_OUTCOME.LAST],
    ['never stored', NEVER_STORED, WAY_IN_OUTCOME.LAST],
    ['not a public native client', NOT_PUBLIC_NATIVE, WAY_IN_OUTCOME.LAST],
  ])(
    'answers the removal of a code-only account last other way in with its only code application %s',
    async (_case, door, outcome) => {
      const rule = ruleFor(CODE_ONLY, [OFFERING], readers({ mobile: door }));

      expect(
        await rule.holdForRemoval(
          new TestUnitOfWork(),
          'user',
          LEFT_BESIDES_IT,
        ),
      ).toBe(outcome);
    },
  );

  it('counts the code when one of two applications that offer it still lets the account in', async () => {
    const rule = ruleFor(
      CODE_ONLY,
      [OFFERING, application('tablet', { emailCode: true })],
      readers({ mobile: BLOCKED, tablet: OPEN }),
    );

    expect(
      await rule.holdForRemoval(new TestUnitOfWork(), 'user', LEFT_BESIDES_IT),
    ).toBe(WAY_IN_OUTCOME.ANOTHER_LEFT);
  });

  it('decides a removal on what its unit of work reads, and advice on committed reads', async () => {
    const rule = ruleFor(
      CODE_ONLY,
      [OFFERING],
      readers({ mobile: BLOCKED }, { mobile: OPEN }),
    );

    expect({
      removal: await rule.holdForRemoval(
        new TestUnitOfWork(),
        'user',
        LEFT_BESIDES_IT,
      ),
      advice: (await rule.adviseOnRemoval('user'))(LEFT_BESIDES_IT),
    }).toEqual({
      removal: WAY_IN_OUTCOME.LAST,
      advice: WAY_IN_OUTCOME.ANOTHER_LEFT,
    });
  });

  it('counts no code when nothing can read where the account signs in', async () => {
    const rule = ruleFor(CODE_ONLY, [OFFERING]);

    expect(
      await rule.holdForRemoval(new TestUnitOfWork(), 'user', LEFT_BESIDES_IT),
    ).toBe(WAY_IN_OUTCOME.LAST);
  });
});
// feature:email-code:end
