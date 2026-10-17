import { requestFingerprint } from './request-fingerprint';

const OPERATION = 'account.create';

describe('requestFingerprint', () => {
  // Failure (R5): a retry whose body serialised its keys in another order is refused as a different request.
  it('matches the same body in another key order', () => {
    expect(
      requestFingerprint(OPERATION, { email: 'a@example.test', role: 'user' }),
    ).toBe(
      requestFingerprint(OPERATION, { role: 'user', email: 'a@example.test' }),
    );
  });

  // Failure (R5): a changed body under a reused key replays the first create instead of a conflict.
  it.each([
    [{ email: 'b@example.test', role: 'user' }],
    [{ email: 'a@example.test', role: 'support' }],
    [{ email: 'a@example.test', role: 'user', name: 'Ann' }],
  ])('differs when a value changes: %j', (body) => {
    expect(requestFingerprint(OPERATION, body)).not.toBe(
      requestFingerprint(OPERATION, { email: 'a@example.test', role: 'user' }),
    );
  });

  // Failure: one key reused for another kind of create replays the wrong record.
  it('differs between operations for the same body', () => {
    const body = { name: 'Editors', permissions: ['posts:read:all'] };
    expect(requestFingerprint('role.create', body)).not.toBe(
      requestFingerprint('invitation.create', body),
    );
  });

  // Failure: a password ends up hashed without salt in a stored record.
  it('leaves the password out of the fingerprint', () => {
    expect(
      requestFingerprint(OPERATION, {
        email: 'a@example.test',
        password: 'one',
      }),
    ).toBe(
      requestFingerprint(OPERATION, {
        email: 'a@example.test',
        password: 'two',
      }),
    );
  });
});
