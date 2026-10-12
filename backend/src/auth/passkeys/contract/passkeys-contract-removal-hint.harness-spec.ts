import * as bcrypt from 'bcrypt';
import {
  BCRYPT_ROUNDS,
  CREDENTIAL_ID,
  FeatureSwitches,
  NOW,
  OTHER_CREDENTIAL_ID,
  PasskeysHarnessSource,
  passkeyServices,
  PASSWORD,
  refusalOf,
} from './passkeys-contract.harness-spec';

const LAST_WAY_IN = { code: 'PASSKEY_LAST_SIGN_IN_METHOD', status: 409 };

interface HintedAccount {
  password?: boolean;
  linked?: boolean;
  secondPasskey?: boolean;
  features: FeatureSwitches;
  /** Written out by hand: the page is told so, and the removal agrees. */
  removable: boolean;
}

const ACCOUNTS: Record<string, HintedAccount> = {
  'nothing else': { features: {}, removable: false },
  'a password': { password: true, features: {}, removable: true }, // feature:email-password
  'a password that cannot be used': {
    password: true,
    features: { password: false },
    removable: false,
  },
  'a linked provider': {
    linked: true,
    features: { password: false },
    removable: true,
  },
  // feature:magic-link:start
  'magic links': {
    features: { password: false, magicLink: true },
    removable: true,
  },
  // feature:magic-link:end
  'a second passkey': {
    secondPasskey: true,
    features: { password: false },
    removable: true,
  },
};

/** The hint the passkey list carries says what the removal would answer. */
export function removalHintCases(harness: PasskeysHarnessSource): void {
  it('tells the page a passkey can go exactly when its removal would go through', async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
    const hinted: Record<string, boolean | undefined> = {};
    const removed: Record<string, boolean> = {};
    for (const [name, account] of Object.entries(ACCOUNTS)) {
      await harness().reset();
      const userId = await harness().seedAccount({
        email: 'hinted@example.test',
        passwordHash: account.password ? passwordHash : undefined,
        linked: account.linked,
      });
      const passkeyId = await harness().seedPasskey({
        userId,
        credentialId: CREDENTIAL_ID,
        createdAt: NOW,
      });
      if (account.secondPasskey) {
        await harness().seedPasskey({
          userId,
          credentialId: OTHER_CREDENTIAL_ID,
          createdAt: NOW,
        });
      }
      const { management } = passkeyServices(harness(), account.features);

      // Asked first, the way a page reads it before it offers the action.
      hinted[name] = (await management.list(userId)).data.canRemove;
      const attempt = management.remove(userId, passkeyId);
      if (account.removable) {
        await attempt;
      } else {
        expect(await refusalOf(attempt)).toEqual(LAST_WAY_IN);
      }
      removed[name] = !(await harness().storedPasskeys()).some(
        (passkey) => passkey.id === passkeyId,
      );
    }

    expect(hinted).toEqual(removed);
    expect(hinted).toEqual({
      'nothing else': false,
      'a password': true, // feature:email-password
      'a password that cannot be used': false,
      'a linked provider': true,
      'magic links': true, // feature:magic-link
      'a second passkey': true,
    });
  });
}
