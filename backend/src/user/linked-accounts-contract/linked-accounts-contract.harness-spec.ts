import { ConfigService } from '@nestjs/config';
import { AccountsContractHarness } from '../../../test/utils/user/accounts-contract/accounts-contract-harness';
import { rerunAtOnce } from '../../../test/utils/session/issuance-contract/issuance-contract-support';
import { OAuthProfile } from '../../auth/oauth/oauth-provider.interface';
import { ProviderSignInStore } from '../../auth/oauth/stores/provider-sign-in.store';
import { AuthFeaturesService } from '../../auth/services/features/auth-features.service';
import { RerunPause } from '../../common/persistence/unit-of-work';
import { AccountLinkingService } from '../services/account-linking.service';
import { ProfileSyncService } from '../services/profile-sync.service';
import { SignInMethodRule } from '../services/sign-in-method.rule';
import { LinkedAccountStore } from '../stores/linked-account.store';
import { SignInMethodStore } from '../stores/sign-in-method.store';

export interface StoredLink {
  provider: string;
  providerId: string;
}

export interface StoredSyncFacts {
  name: string;
  avatarUrl: string | null;
  primaryProvider: string | null;
  lastSyncedProvider: string | null;
  profileSyncedAt: Date | null;
}

/** The accounts harness, plus what the linked-account cases need of a database. */
export interface LinkedAccountsContractHarness extends AccountsContractHarness {
  readonly links: LinkedAccountStore;
  readonly signInMethods: SignInMethodStore;
  readonly providerSignIn: ProviderSignInStore;
  /** The links an account has, in the order they were made. */
  storedLinks(userId: string): Promise<StoredLink[]>;
  syncFacts(userId: string): Promise<StoredSyncFacts | null>;
  /** Sets when an account was last synced, committed, around the adapters. */
  markSynced(userId: string, at: Date | null): Promise<void>;
  /** Sets the provider an account was created with, committed, around the adapters. */
  setAuthProvider(userId: string, provider: string): Promise<void>;
}

export type LinkedHarnessSource = () => LinkedAccountsContractHarness;

export interface LinkedFixture {
  ownerId: string;
  otherId: string;
}

export const OWNER_EMAIL = 'owner@example.test';

export function profileOf(
  providerId: string,
  overrides: Partial<OAuthProfile> = {},
): OAuthProfile {
  return {
    providerId,
    email: OWNER_EMAIL,
    emailVerified: true,
    name: 'Provider Name',
    ...overrides,
  };
}

export interface LinkedServices {
  linking: AccountLinkingService;
  sync: ProfileSyncService;
}

/** What the deployment offers an address by itself. Unset is the default. */
export interface SignInSwitchesOf {
  password?: boolean;
  magicLink?: boolean;
  emailCode?: boolean; // feature:email-code
}

/** A case that names no switch runs on the first of these the project has. */
const EMAIL_WAYS_IN: Required<
  Pick<SignInSwitchesOf, 'password' | 'magicLink'>
>[] = [
  { password: true, magicLink: false }, // feature:email-password
  { password: false, magicLink: true }, // feature:magic-link
  { password: false, magicLink: false },
];
const UNSET = EMAIL_WAYS_IN[0];

/** The real services on this database's adapter. */
export function linkedServicesOn(
  harness: LinkedAccountsContractHarness,
  pause: RerunPause = rerunAtOnce,
  switches: SignInSwitchesOf = {},
): LinkedServices {
  const features = new AuthFeaturesService(
    new ConfigService({
      auth: { passwordEnabled: switches.password ?? UNSET.password },
      magicLink: { enabled: switches.magicLink ?? UNSET.magicLink },
    }),
  );
  return {
    linking: new AccountLinkingService(
      harness.links,
      new SignInMethodRule(
        harness.signInMethods,
        features,
        // feature:email-code:start
        new ConfigService({
          emailCode: { enabled: switches.emailCode ?? false },
          // An application has to offer the code for it to be a way in.
          auth: {
            nativeEnabled: true,
            nativeApplications: [
              { clientId: 'native-app', signIn: { emailCode: true } },
            ],
          },
        }),
        // feature:email-code:end
      ),
      harness.runner(pause),
    ),
    sync: new ProfileSyncService(
      harness.links,
      new ConfigService({ profileSync: { fields: 'name,picture' } }),
    ),
  };
}

export async function seedLinkedFixture(
  harness: LinkedAccountsContractHarness,
): Promise<LinkedFixture> {
  await harness.seedRole({
    name: 'User',
    slug: 'user',
    level: 1,
    permissions: [],
  });
  return {
    ownerId: await harness.seedAccount({
      email: OWNER_EMAIL,
      name: 'Owner',
      role: 'user',
    }),
    otherId: await harness.seedAccount({
      email: 'other@example.test',
      name: 'Other',
      role: 'user',
    }),
  };
}
