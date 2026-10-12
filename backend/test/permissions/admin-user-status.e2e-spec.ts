import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UserRole } from '../../src/user/enums/user-role.enum';
import {
  SEED_ADMIN,
  SEED_MANAGER,
  SEED_USER,
  type SeedUser,
} from '../constants/seed-users';
import type { ApiBody } from '../types/e2e-responses';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import { ABSENT_ID } from '../utils/route-id-answers';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface StatusResponse {
  id: string;
  isDeleted: boolean;
  deletedAt?: string;
}

interface ErrorBody {
  error: { code: string };
}

describe('PATCH /api/admin/users/:id/status (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
  });

  async function idOf(seed: SeedUser): Promise<string> {
    const id = await e2e.state.accounts.accountIdFor(seed.email);
    if (!id) {
      throw new Error(`seed user ${seed.email} is missing`);
    }
    return id;
  }

  function setStatus(agent: TestAgent, id: string, isActive: boolean) {
    return agent.patch(`/api/admin/users/${id}/status`).send({ isActive });
  }

  it('reactivates a deactivated user, who signs in again with a new session', async () => {
    const id = await idOf(SEED_USER);
    const before = await loginAs(e2e.httpServer, SEED_USER);
    await setStatus(admin, id, false).expect(200);

    const reactivated = await setStatus(admin, id, true).expect(200);

    expect((reactivated.body as ApiBody<StatusResponse>).data).toEqual({
      id,
      isDeleted: false,
    });
    const stored = await e2e.state.accounts.accountWithId(id);
    expect(stored?.isDeleted).toBe(false);
    expect(stored?.deletedAt).toBeUndefined();
    // The session ended by the deactivation does not come back.
    expect((await before.get('/api/user/profile')).status).toBe(401);
    const after = await loginAs(e2e.httpServer, SEED_USER);
    await after.get('/api/user/profile').expect(200);
  });

  it('refuses a reactivation by an actor who does not outrank the target', async () => {
    const { _id: id } = await e2e.state.accounts.createAccount({
      email: 'second-manager@seed.local',
      name: 'Second Manager',
      role: UserRole.MANAGER,
      isVerified: true,
    });
    await setStatus(admin, id, false).expect(200);
    const manager = await loginAs(e2e.httpServer, SEED_MANAGER);

    const refused = await setStatus(manager, id, true).expect(403);

    expect((refused.body as ErrorBody).error.code).toBe(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    );
    expect((await e2e.state.accounts.accountWithId(id))?.isDeleted).toBe(true);
  });

  it('answers 404 when reactivating a user who never existed', async () => {
    const missing = await setStatus(admin, ABSENT_ID, true).expect(404);

    expect((missing.body as ErrorBody).error.code).toBe(
      ErrorCode.USER_NOT_FOUND,
    );
  });

  it('keeps an active user active when asked to activate again', async () => {
    const id = await idOf(SEED_USER);
    const session = await loginAs(e2e.httpServer, SEED_USER);

    const repeated = await setStatus(admin, id, true).expect(200);

    expect((repeated.body as ApiBody<StatusResponse>).data).toEqual({
      id,
      isDeleted: false,
    });
    await session.get('/api/user/profile').expect(200);
  });

  it('answers 404 when deactivating a user who is already deactivated', async () => {
    const id = await idOf(SEED_USER);
    await setStatus(admin, id, false).expect(200);

    const repeated = await setStatus(admin, id, false).expect(404);

    expect((repeated.body as ErrorBody).error.code).toBe(
      ErrorCode.USER_NOT_FOUND,
    );
  });
});
