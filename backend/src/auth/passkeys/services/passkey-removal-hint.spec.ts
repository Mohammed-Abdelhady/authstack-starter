import { ConfigService } from '@nestjs/config';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { SignInMethodRule } from '../../../user/services/sign-in-method.rule';
import { SignInMethodStore } from '../../../user/stores/sign-in-method.store';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { PasskeyListResponseDto } from '../dto/passkey-summary.dto';
import { PasskeyStore, StoredPasskey } from '../stores/passkey.store';
import { requiredRelyingPartiesOf } from './browser-passkey-policy.harness-spec';
import { PasskeyConfigService } from './passkey-config.service';
import { PasskeyManagementService } from './passkey-management.service';

/** Written out, so a changed rule cannot agree with itself. */
const WEB_RP_ID = 'localhost';
const APP_RP_ID = 'app.example.test';
const USER_ID = 'hinted-account';

/** A stored passkey of the account. None recorded means the web relying party. */
function passkeyOf(id: string, rpId?: string): StoredPasskey {
  return {
    id,
    userId: USER_ID,
    ...(rpId ? { rpId } : {}),
    credentialId: `credential-${id}`,
    publicKey: Buffer.from([1, 2, 3]),
    counter: 0,
    transports: ['internal'],
    backedUp: false,
    name: id,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

interface HintedAccount {
  linkedProviders: string[];
  /** Beside its web passkey, the account holds one made in an app. */
  appPasskey: boolean;
}

/** The list for an account the web application lets in with a passkey only. */
function listFor(
  account: HintedAccount,
): Promise<ApiResponse<PasskeyListResponseDto>> {
  const passkeys = [
    passkeyOf('web'),
    ...(account.appPasskey ? [passkeyOf('app', APP_RP_ID)] : []),
  ];
  const config = new ConfigService({
    auth: { passwordEnabled: false },
    passkeys: { rpId: WEB_RP_ID },
  });
  const applications = browserApplicationsForTest(config);
  const held = {
    emailSignIn: false,
    hasPassword: false,
    linkedProviders: account.linkedProviders,
    passkeys: passkeys.length,
  };
  return new PasskeyManagementService(
    partialMock<PasskeyStore>({
      listForAccount: () => Promise.resolve(passkeys),
    }),
    new SignInMethodRule(
      partialMock<SignInMethodStore>({
        readForAccount: () => Promise.resolve(held),
      }),
      new AuthFeaturesService(config, applications),
    ),
    partialMock<UnitOfWorkRunner>({
      run: (work) => work(partialMock<UnitOfWork>()),
    }),
    new PasskeyConfigService(config),
    applications,
    requiredRelyingPartiesOf([WEB_RP_ID]),
  ).list(USER_ID);
}

describe('PasskeyManagementService removal hint, where a passkey is required', () => {
  // Failure: the page offers a removal the server refuses because no other
  // way in stands in for a required passkey, or hides one that could go.
  it.each<{ account: string; held: HintedAccount; canRemove: boolean }>([
    {
      account: 'a provider and the required passkey',
      held: { linkedProviders: ['google'], appPasskey: false },
      canRemove: false,
    },
    {
      account: 'the required passkey and an app passkey',
      held: { linkedProviders: [], appPasskey: true },
      canRemove: false,
    },
    {
      account: 'a provider, the required passkey and an app passkey',
      held: { linkedProviders: ['google'], appPasskey: true },
      canRemove: true,
    },
  ])('says whether a passkey can go: $account', async ({ held, canRemove }) => {
    expect((await listFor(held)).data.canRemove).toBe(canRemove);
  });
});
