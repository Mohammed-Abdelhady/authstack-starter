import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { AccountCreationRefusedError } from './account-creation-refused.error';

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
