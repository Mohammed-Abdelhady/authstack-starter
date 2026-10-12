import { ConfigService } from '@nestjs/config';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { RolePermissions } from '../../../role/stores/role-permissions';
import { PasskeyCredentialDto } from '../../passkeys/dto/passkey-credential.dto';
import { PasskeyAssertionService } from '../../passkeys/services/passkey-assertion.service';
import { PasskeyLoginService } from '../../passkeys/services/passkey-login.service';
import { PasskeySecondFactorVerifier } from '../../passkeys/services/passkey-second-factor.verifier';
import {
  PasskeyAccount,
  PasskeyAccounts,
  PasskeySignIn,
} from '../../passkeys/stores/passkey-accounts';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { SessionCookieService } from '../../services/sessions/session-cookie.service';
import { Sessions } from '../../services/sessions/sessions';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import { SignInAccount } from '../../utils/authenticated-user.util';
import {
  browser,
  Browser,
  CHALLENGE_COOKIE,
  codeAt,
  OWNER_EMAIL,
  refusalOf,
  seedEnabled,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  TwoFactorServices,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const CHALLENGE_INVALID = {
  code: 'TWO_FACTOR_CHALLENGE_INVALID',
  status: 401,
};
const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};
const HELD = { requiresTwoFactor: true, user: null };
const KEY = 'Y3JlZGVudGlhbC1vbmU';
const OTHER_KEY = 'Y3JlZGVudGlhbC10d28';

function credential(id: string): PasskeyCredentialDto {
  return Object.assign(new PasskeyCredentialDto(), {
    id,
    rawId: id,
    response: {},
    clientExtensionResults: {},
    type: 'public-key',
  });
}

interface Steps {
  services: TwoFactorServices;
  /** Sessions the passkey step issued itself, with no second step. */
  issuedAtOnce: string[];
  /** The first step with a passkey. Answers the body the route would. */
  passkeyFirst(
    holder: Browser,
    key: string,
    userVerified: boolean,
  ): Promise<unknown>;
  /** The first step of every other route: a password, a link, a provider. */
  passwordFirst(holder: Browser): Promise<unknown>;
  /** The second step with a passkey. */
  passkeySecond(
    holder: Browser,
    key: string,
    userVerified: boolean,
  ): Promise<unknown>;
}

/**
 * The real passkey sign-in, shared sign-in and second step on this database's
 * challenge store. The signature check has its own contract, so a case says
 * here what it answered: whose key it was and whether its user was verified.
 */
function stepsFor(harness: TwoFactorHarnessSource, ownerId: string): Steps {
  const features = new AuthFeaturesService(new ConfigService({}));
  const account: SignInAccount = {
    id: ownerId,
    email: OWNER_EMAIL,
    name: 'Owner',
    role: 'user',
    permissions: [],
    authProvider: 'email',
    isVerified: true,
    twoFactorEnabled: true,
  };
  let nextAssertion = { key: KEY, userVerified: false };
  const assertions = partialMock<PasskeyAssertionService>({
    verify: () =>
      Promise.resolve({
        passkey: {
          id: nextAssertion.key,
          userId: ownerId,
          credentialId: nextAssertion.key,
          publicKey: Buffer.from([1]),
          counter: 0,
          transports: [],
          backedUp: false,
          name: 'Key',
          lastUsedAt: null,
          createdAt: new Date(0),
        },
        userVerified: nextAssertion.userVerified,
      }),
  });
  const services = twoFactorServices(harness(), [
    new PasskeySecondFactorVerifier(features, assertions),
  ]);
  const completion = new SignInCompletion(
    partialMock<RolePermissions>({}),
    partialMock<Sessions>({}),
    partialMock<SessionCookieService>({}),
    features,
    services.challenge,
  );
  const issuedAtOnce: string[] = [];
  const signIn = new (class extends PasskeySignIn {
    issueSession(signedIn: PasskeyAccount) {
      issuedAtOnce.push(signedIn.id);
      return Promise.resolve({ ...account, id: signedIn.id });
    }

    completeSignIn(_signingIn: PasskeyAccount, response: Browser['response']) {
      return completion.completeSignIn(account, response, 'passkey');
    }
  })();
  const login = new PasskeyLoginService(
    partialMock<PasskeyAccounts>({
      findAccount: (userId: string) =>
        Promise.resolve({
          id: userId,
          email: OWNER_EMAIL,
          name: 'Owner',
          isDeleted: false,
        }),
    }),
    assertions,
    signIn,
  );

  return {
    services,
    issuedAtOnce,
    passkeyFirst: async (holder, key, userVerified) => {
      nextAssertion = { key, userVerified };
      const answer = await login.verify(
        { response: credential(key) },
        holder.request,
        holder.response,
      );
      return answer.data;
    },
    passwordFirst: (holder) =>
      completion.completeSignIn(account, holder.response, 'password'),
    passkeySecond: (holder, key, userVerified) => {
      nextAssertion = { key, userVerified };
      return services.login.verify(
        { passkeyResponse: credential(key) },
        holder.request,
        holder.response,
      );
    },
  };
}

/** A sign-in that starts with a passkey, through to its second step. */
export function passkeyStepCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('refuses a key touched without user verification as the second step after one, whichever key it is', async () => {
    const { ownerId } = fixture();
    const steps = stepsFor(harness, ownerId);
    await seedEnabled(harness(), steps.services.crypto, ownerId);
    const holder = browser();

    expect(await steps.passkeyFirst(holder, KEY, false)).toEqual(HELD);
    expect(await refusalOf(steps.passkeySecond(holder, KEY, false))).toEqual(
      VERIFICATION_FAILED,
    );
    expect(
      await refusalOf(steps.passkeySecond(holder, OTHER_KEY, false)),
    ).toEqual(VERIFICATION_FAILED);

    expect(steps.services.signIn.accountIds).toEqual([]);
    expect(steps.issuedAtOnce).toEqual([]);
    expect(await harness().storedChallenges()).toMatchObject([
      { userId: ownerId, attempts: 2, claimed: false },
    ]);
  });

  it('signs in once when the same key answers again with user verification', async () => {
    const { ownerId } = fixture();
    const steps = stepsFor(harness, ownerId);
    await seedEnabled(harness(), steps.services.crypto, ownerId);
    const holder = browser();
    await steps.passkeyFirst(holder, KEY, false);
    const copy = browser(holder.cookies);

    await steps.passkeySecond(holder, KEY, true);

    expect(steps.services.signIn.accountIds).toEqual([ownerId]);
    expect(await harness().storedChallenges()).toEqual([]);
    expect(await refusalOf(steps.passkeySecond(copy, KEY, true))).toEqual(
      CHALLENGE_INVALID,
    );
    expect(steps.services.signIn.accountIds).toEqual([ownerId]);
  });

  it('takes a code from the app as the second step after a passkey', async () => {
    const { ownerId } = fixture();
    const steps = stepsFor(harness, ownerId);
    await seedEnabled(harness(), steps.services.crypto, ownerId);
    const holder = browser();
    await steps.passkeyFirst(holder, KEY, false);

    await steps.services.login.verify(
      { code: codeAt(harness().clock, TOTP_SECRET) },
      holder.request,
      holder.response,
    );

    expect(steps.services.signIn.accountIds).toEqual([ownerId]);
  });

  it('still takes a key touched without user verification as the second step after a password', async () => {
    const { ownerId } = fixture();
    const steps = stepsFor(harness, ownerId);
    await seedEnabled(harness(), steps.services.crypto, ownerId);
    const holder = browser();

    expect(await steps.passwordFirst(holder)).toEqual({
      requiresTwoFactor: true,
    });
    await steps.passkeySecond(holder, KEY, false);

    expect(steps.services.signIn.accountIds).toEqual([ownerId]);
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('holds nothing for a passkey that verified its user at the first step', async () => {
    const { ownerId } = fixture();
    const steps = stepsFor(harness, ownerId);
    await seedEnabled(harness(), steps.services.crypto, ownerId);
    const holder = browser();

    expect(await steps.passkeyFirst(holder, KEY, true)).toMatchObject({
      requiresTwoFactor: false,
      user: { id: ownerId },
    });

    expect(steps.issuedAtOnce).toEqual([ownerId]);
    expect(holder.cookies[CHALLENGE_COOKIE]).toBeUndefined();
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('takes a passkey as the second step while the codes of the account are locked, and leaves the lock as it is', async () => {
    const { ownerId } = fixture();
    const steps = stepsFor(harness, ownerId);
    await seedEnabled(harness(), steps.services.crypto, ownerId);
    const locked = {
      failedAttempts: 5,
      lockedUntil: new Date(TEST_NOW.getTime() + 60_000),
    };
    await harness().seedFailures(ownerId, locked);
    const holder = browser();
    await steps.passwordFirst(holder);

    await steps.passkeySecond(holder, KEY, false);

    // A key cannot be guessed, so the lock on codes does not close it.
    expect(steps.services.signIn.accountIds).toEqual([ownerId]);
    expect(await harness().failures(ownerId)).toEqual(locked);
  });
}
