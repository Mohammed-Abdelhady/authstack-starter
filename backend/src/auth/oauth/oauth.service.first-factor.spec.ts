import { ConfigService } from '@nestjs/config';
import { AddressLedger } from '../../common/persistence/address-ledger';
import { Clock } from '../../common/services/clock';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import {
  createResponseMock,
  partialMock,
} from '../../common/testing/test-doubles.harness-spec';
import { AccountLinkingService } from '../../user/services/account-linking.service';
import { ProfileSyncService } from '../../user/services/profile-sync.service';
import { StoredAccount } from '../../user/stores/stored-account';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { Sessions } from '../services/sessions/sessions';
import { SignInCompletion } from '../services/sessions/sign-in-completion';
import { OAuthProviderStrategy } from './oauth-provider.interface';
import { OAuthService } from './oauth.service';
import { ProviderSignInStore } from './stores/provider-sign-in.store';

const PROFILE = {
  providerId: 'google-42',
  email: 'user@example.com',
  emailVerified: true,
  name: 'Ada',
};

/** The provider, which answers every code with the profile above. */
function strategy(): OAuthProviderStrategy {
  return {
    id: 'google',
    displayName: 'Google',
    envPrefix: 'GOOGLE',
    supportsPkce: true,
    usesOidc: true,
    emailAlwaysVerified: true,
    autoLinksByEmail: true,
    callbackMethod: 'GET',
    isEnabled: () => true,
    getAuthorizationUrl: () => 'https://example.test',
    exchangeCode: () => Promise.resolve({ accessToken: 'token' }),
    fetchProfile: () => Promise.resolve(PROFILE),
  };
}

/** A store that already links the provider identity to one account. */
class LinkedAccountStore extends ProviderSignInStore {
  constructor(private readonly account: StoredAccount) {
    super();
  }

  findByIdentity(): Promise<StoredAccount | null> {
    return Promise.resolve(this.account);
  }

  findByAddress(): Promise<StoredAccount | null> {
    return Promise.resolve(null);
  }

  linkFirstSignIn(): Promise<StoredAccount> {
    return Promise.reject(new Error('the account is linked already'));
  }

  createFromProviderIn(): Promise<StoredAccount> {
    return Promise.reject(new Error('the account exists already'));
  }
}

function unexpectedLedgerCall(): Promise<never> {
  return Promise.reject(new Error('unexpected ledger call'));
}

class UnexpectedLedger extends AddressLedger {
  claim = unexpectedLedgerCall;
  holdsLiveClaim = unexpectedLedgerCall;
  release = unexpectedLedgerCall;
  isFree = unexpectedLedgerCall;
}

describe('OAuthService sign-in', () => {
  it('finishes the sign-in as one a provider opened', async () => {
    const account = partialMock<StoredAccount>({
      id: 'user-1',
      isDeleted: false,
    });
    const completeSignIn = jest
      .fn()
      .mockResolvedValue({ requiresTwoFactor: true });
    const policy = new AccountCreationPolicy();
    const assertMayCreate = jest.spyOn(policy, 'assertMayCreate');
    const service = new OAuthService(
      new LinkedAccountStore(account),
      partialMock<SignInCompletion>({ completeSignIn }),
      partialMock<ProfileSyncService>({
        syncProfileFromProvider: () => Promise.resolve(account),
      }),
      partialMock<AccountLinkingService>({}),
      partialMock<Sessions>({}),
      new SessionCookieService(new ConfigService({})),
      policy,
      new UnexpectedLedger(),
      new Clock(),
      partialMock<UnitOfWorkRunner>({}),
    );
    const response = createResponseMock({});

    const outcome = await service.login({
      strategy: strategy(),
      code: 'auth-code',
      redirectUri: 'https://api.example.com/callback',
      response,
      locale: 'en',
    });

    expect(assertMayCreate).not.toHaveBeenCalled();
    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(completeSignIn.mock.calls).toEqual([
      [
        account,
        response,
        'provider', // feature:totp
      ],
    ]);
  });
});
