import { storedEmailCodePurpose } from './email-code.store';

describe('stored email code purpose', () => {
  it('reads back a purpose this build knows', () => {
    expect(storedEmailCodePurpose('sign-in')).toBe('sign-in');
  });

  it.each(['proof', 'signup', 'Sign-In', ''])(
    'refuses %p rather than treating it as a sign-in code',
    (value) => {
      expect(() => storedEmailCodePurpose(value)).toThrow(
        'Unknown email code purpose',
      );
    },
  );
});
