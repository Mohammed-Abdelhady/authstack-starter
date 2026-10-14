import { SEED_USER_DEFINITIONS, seedUserDefinitions } from './user.seed';

const accountsOf = (definitions: { email: string; role: string }[]) =>
  definitions.map(({ email, role }) => ({ email, role }));

describe('seed accounts follow the host roles', () => {
  it('seeds one account per default role, as before', () => {
    expect(accountsOf(SEED_USER_DEFINITIONS)).toEqual([
      { email: 'user@seed.local', role: 'user' },
      { email: 'support@seed.local', role: 'support' },
      { email: 'manager@seed.local', role: 'manager' },
      { email: 'admin@seed.local', role: 'admin' },
    ]);
  });

  it('seeds no account on a role an empty host list does not seed', () => {
    expect(accountsOf(seedUserDefinitions([]))).toEqual([
      { email: 'user@seed.local', role: 'user' },
      { email: 'admin@seed.local', role: 'admin' },
    ]);
  });
});
