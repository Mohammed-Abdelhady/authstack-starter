// The services below sit above the storage seam. Loading any of them must not
// load a database driver, directly or through what they import.
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

const SERVICES: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AuthService', () => import('./auth.service')],
  ['AuthGuard', () => import('./guards/auth.guard')],
  ['BrowserProofGuard', () => import('./guards/browser-proof.guard')],
  ['Sessions', () => import('./services/sessions/sessions')],
  ['SignInCompletion', () => import('./services/sessions/sign-in-completion')],
  [
    'UserSessionsService',
    () => import('../user/services/user-sessions.service'),
  ],
  [
    'NativeAccessService',
    () => import('../session/native/access/native-access.service'),
  ],
  ['AuthController', () => import('./auth.controller')],
  ['UserSessionsController', () => import('../user/user-sessions.controller')],
  ['HealthService', () => import('../health/health.service')],
  ['HealthController', () => import('../health/health.controller')],
  ['SeedService', () => import('../database/seeds/seed.service')],
  ['RoleSeedService', () => import('../database/seeds/role.seed')],
  [
    'GlobalExceptionFilter',
    () => import('../common/filters/global-exception.filter'),
  ],
  ['StorageStartup', () => import('../common/persistence/storage-startup')],
];

describe('services above the storage seam', () => {
  it.each(SERVICES)(
    '%s loads without a database driver',
    async (name, load) => {
      const loaded = await load();

      expect(typeof loaded[name]).toBe('function');
    },
  );
});
