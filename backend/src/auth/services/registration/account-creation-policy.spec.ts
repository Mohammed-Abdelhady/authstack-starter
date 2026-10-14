import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { WEB_CLIENT_ID } from '../../../session/constants/client-ids';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { AccountCreationRequest } from '../../types/account-creation';
import { AccountCreationPolicy } from './account-creation-policy';
import { AccountCreationRefusedError } from './account-creation-refused.error';

class TestUnitOfWork extends UnitOfWork {}

const REQUESTS: AccountCreationRequest[] = [
  { application: WEB_CLIENT_ID, method: ACCOUNT_CREATION_METHOD.PASSWORD },
  { application: 'native-client', method: ACCOUNT_CREATION_METHOD.MAGIC_LINK },
  { application: WEB_CLIENT_ID, method: ACCOUNT_CREATION_METHOD.PROVIDER },
  { application: null, method: ACCOUNT_CREATION_METHOD.STAFF },
];

describe('account creation policy contract', () => {
  it('keeps the creation vocabulary stable', () => {
    expect(ACCOUNT_CREATION_METHOD).toEqual({
      PASSWORD: 'password',
      MAGIC_LINK: 'magic_link',
      PROVIDER: 'provider',
      STAFF: 'staff',
    });
  });

  it.each(REQUESTS)(
    'initially permits $method for $application',
    async (request) => {
      await expect(
        new AccountCreationPolicy().assertMayCreate(
          request,
          new TestUnitOfWork(),
        ),
      ).resolves.toBeUndefined();
    },
  );

  it('identifies a refused creation with the catalogue code and HTTP 403', () => {
    const error = new AccountCreationRefusedError();

    expect(error.getStatus()).toBe(403);
    expect(error.getCode()).toBe('ACCOUNT_CREATION_REFUSED');
    expect(error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
  });
});
