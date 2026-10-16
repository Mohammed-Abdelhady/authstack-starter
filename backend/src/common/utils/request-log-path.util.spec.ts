import { getLoggableRequestPath } from './request-log-path.util';

describe('getLoggableRequestPath', () => {
  it.each([
    {
      value:
        '/api/oauth/authorize/transaction/65bd2588-08ef-4489-9b07-543ca8124319',
      expected: '/api/oauth/authorize/transaction/[redacted]',
    },
    {
      value: '/api/oauth/authorize/transaction/live-id?state=secret',
      expected: '/api/oauth/authorize/transaction/[redacted]',
    },
    {
      value: '/api/oauth/authorize/transaction/live-id/',
      expected: '/api/oauth/authorize/transaction/[redacted]/',
    },
    {
      value: '/api/oauth/authorize/transaction',
      expected: '/api/oauth/authorize/transaction',
    },
    {
      value: '/api/oauth/authorize/transactional/id',
      expected: '/api/oauth/authorize/transactional/id',
    },
    { value: '/api/user/profile?token=secret', expected: '/api/user/profile' },
    {
      value: `/api/auth/account-deletion/r1.1760000000000.${'0f'.repeat(32)}`,
      expected: '/api/auth/account-deletion/[redacted]',
    },
  ])('maps $value to a safe log path', ({ value, expected }) => {
    expect(getLoggableRequestPath(value)).toBe(expected);
  });
});
