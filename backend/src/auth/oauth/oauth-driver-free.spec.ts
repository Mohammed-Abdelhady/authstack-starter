// Signing in through a provider sits above the storage seam: loading it must
// not load a database driver, directly or through what it imports.
// feature:mongodb:start
jest.mock('mongoose', () => {
  throw new Error('mongoose was loaded by a service above the seam');
});
jest.mock('mongodb', () => {
  throw new Error('mongodb was loaded by a service above the seam');
});
jest.mock('@nestjs/mongoose', () => {
  throw new Error('@nestjs/mongoose was loaded by a service above the seam');
});
// feature:mongodb:end
// feature:postgres:start
jest.mock('kysely', () => {
  throw new Error('kysely was loaded by a service above the seam');
});
jest.mock('pg', () => {
  throw new Error('pg was loaded by a service above the seam');
});
// feature:postgres:end

describe('provider sign-in above the storage seam', () => {
  it('loads OAuthService without a database driver', async () => {
    const loaded = await import('./oauth.service');

    expect(typeof loaded.OAuthService).toBe('function');
  });
});
