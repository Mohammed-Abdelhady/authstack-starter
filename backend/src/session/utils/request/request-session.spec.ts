import { requestSessionId } from './request-session';

describe('requestSessionId', () => {
  it('reads the id from an authenticated cookie session', () => {
    const id = '507f1f77bcf86cd799439011';

    expect(requestSessionId({ session: { id } })).toBe(
      '507f1f77bcf86cd799439011',
    );
  });

  it('reads the id from an authenticated bearer session', () => {
    expect(
      requestSessionId({ session: { id: '507f1f77bcf86cd799439012' } }),
    ).toBe('507f1f77bcf86cd799439012');
  });

  it.each([
    ['missing session', {}],
    ['null session', { session: null }],
    ['missing id', { session: {} }],
    ['empty id', { session: { id: '' } }],
  ])('returns null for %s', (_label, request) => {
    expect(requestSessionId(request)).toBeNull();
  });
});
