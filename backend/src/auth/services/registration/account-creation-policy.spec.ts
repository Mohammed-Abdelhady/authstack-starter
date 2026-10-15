import { ErrorCode } from '../../../common/enums/error-code.enum';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import type { IssuanceApplication } from '../../../session/issuance/browser-issuance.store';
import type { IssuanceApplications } from '../../../session/issuance/issuance-applications';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { AccountCreationPolicy } from './account-creation-policy';
import { AccountCreationRefusedError } from './account-creation-refused.error';
import { SelfSignUpRefusedError } from './self-sign-up-refused.error';

const WORK = partialMock<UnitOfWork>();
const OPEN_CUSTOMER_APPLICATION: IssuanceApplication = {
  clientId: 'web',
  platform: 'web',
  enabled: true,
  sessionVersion: 0,
  allowedScopes: ['api'],
  policy: { absoluteLifetimeMs: 3_600_000, idleLifetimeMs: 600_000 },
  signUp: 'open',
  accountAudience: 'customer',
};

function policyOn(application: IssuanceApplication): AccountCreationPolicy {
  return new AccountCreationPolicy(
    partialMock<IssuanceApplications>({
      requireEnabled: () => Promise.resolve(application),
      hasAccountAudience: () => Promise.resolve(true),
    }),
  );
}

describe('account creation policy contract', () => {
  it('keeps the creation vocabulary stable', () => {
    expect(ACCOUNT_CREATION_METHOD).toEqual({
      PASSWORD: 'password',
      MAGIC_LINK: 'magic_link',
      PROVIDER: 'provider',
      STAFF: 'staff',
    });
  });

  it('identifies a refused creation with the catalogue code and HTTP 403', () => {
    const error = new AccountCreationRefusedError();

    expect(error.getStatus()).toBe(403);
    expect(error.getCode()).toBe('ACCOUNT_CREATION_REFUSED');
    expect(error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
  });
});

// Failure: a self sign-up stores an account that an application requiring a
// passkey can never let in, while the caller is told the code was wrong.
describe('account creation where a passkey is required', () => {
  const requiresPasskey = {
    ...OPEN_CUSTOMER_APPLICATION,
    requirePasskey: true,
  };

  it.each([
    ACCOUNT_CREATION_METHOD.PASSWORD,
    ACCOUNT_CREATION_METHOD.MAGIC_LINK,
    ACCOUNT_CREATION_METHOD.PROVIDER,
  ])('refuses %s sign-up before anything is created', async (method) => {
    await expect(
      policyOn(requiresPasskey).assertMayCreate(
        { application: 'web', method },
        WORK,
      ),
    ).rejects.toBeInstanceOf(SelfSignUpRefusedError);
  });

  it('still lets staff create the account', async () => {
    await expect(
      policyOn(requiresPasskey).assertMayCreate(
        { application: 'web', method: ACCOUNT_CREATION_METHOD.STAFF },
        WORK,
      ),
    ).resolves.toBeUndefined();
  });

  it('admits self sign-up with the application audience when no passkey is required', async () => {
    await expect(
      policyOn(OPEN_CUSTOMER_APPLICATION).assertMayCreate(
        { application: 'web', method: ACCOUNT_CREATION_METHOD.PASSWORD },
        WORK,
      ),
    ).resolves.toBe('customer');
  });
});
