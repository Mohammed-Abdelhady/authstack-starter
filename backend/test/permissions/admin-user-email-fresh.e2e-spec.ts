import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SEED_ADMIN } from '../constants/seed-users';
import { bootE2eApp, loginAs, E2eApp, TestAgent } from '../utils/e2e-app';
import { inWindow } from '../utils/pending-race';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const ORIGINAL_EMAIL = 'fresh-original@example.test';
const NEW_EMAIL = 'fresh-next@example.test';
const NEW_NAME = 'Updated Name';

interface ErrorBody {
  error: { code: string };
}

describe('admin email writes authorize fresh state before persistence', () => {
  let e2e: E2eApp;
  let admin: TestAgent;
  let actorId: string;
  let targetId: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    const found = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
    if (!found) throw new Error('Missing admin fixture');
    actorId = found;
    ({ _id: targetId } = await e2e.state.accounts.createAccount({
      email: ORIGINAL_EMAIL,
      name: 'Target',
      role: UserRole.USER,
      addressGeneration: 0,
      isVerified: true,
    }));
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  function move() {
    return admin.patch(`/api/admin/users/${targetId}`).send({
      email: NEW_EMAIL,
      name: NEW_NAME,
    });
  }

  async function stored() {
    const user = await e2e.state.accounts.accountWithId(targetId);
    return {
      email: user?.email,
      pendingEmail: user?.pendingEmail,
      name: user?.name,
      generation: user?.addressGeneration,
      verified: user?.isVerified,
    };
  }

  function beforePendingWrite(interfere: () => Promise<unknown>) {
    return inWindow(
      (gate) => {
        const accounts = e2e.app.get(AdminAccountStore);
        const take = accounts.takeAccountForChange.bind(accounts);
        const spy = jest
          .spyOn(accounts, 'takeAccountForChange')
          .mockImplementation(async (unitOfWork, id) => {
            await gate.hold();
            return take(unitOfWork, id);
          });
        return () => spy.mockRestore();
      },
      () => Promise.resolve(move()),
      interfere,
    );
  }

  it('stores the name and the new generation, and keeps the address until it is confirmed', async () => {
    await move().expect(200);
    expect(await stored()).toEqual({
      email: ORIGINAL_EMAIL,
      pendingEmail: NEW_EMAIL,
      name: NEW_NAME,
      generation: 1,
      verified: true,
    });
  });

  it.each([
    {
      change: () =>
        e2e.state.records.changeAccountRole(actorId, UserRole.MANAGER),
      code: ErrorCode.EMAIL_CHANGE_NOT_ALLOWED,
    },
    {
      change: () => e2e.state.records.markAccountDeleted(actorId),
      code: ErrorCode.SESSION_INVALID,
    },
  ])('refuses a stale actor after $code', async ({ change, code }) => {
    const response = await beforePendingWrite(change);
    expect(response.status).toBe(
      code === ErrorCode.SESSION_INVALID ? 401 : 403,
    );
    expect((response.body as ErrorBody).error.code).toBe(code);
    expect(await stored()).toEqual({
      email: ORIGINAL_EMAIL,
      pendingEmail: undefined,
      name: 'Target',
      generation: 0,
      verified: true,
    });
  });

  it('refuses an email edit after the target becomes a peer', async () => {
    const response = await beforePendingWrite(() =>
      e2e.state.records.changeAccountRole(targetId, UserRole.ADMIN),
    );
    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error.code).toBe(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    );
    expect(await stored()).toEqual({
      email: ORIGINAL_EMAIL,
      pendingEmail: undefined,
      name: 'Target',
      generation: 0,
      verified: true,
    });
  });

  it('does not overwrite an email generation committed during preparation', async () => {
    const response = await beforePendingWrite(() =>
      e2e.state.records.moveAddressGeneration(targetId, 2, false),
    );
    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error.code).toBe(ErrorCode.CONFLICT);
    expect(await stored()).toEqual({
      email: ORIGINAL_EMAIL,
      pendingEmail: undefined,
      name: 'Target',
      generation: 2,
      verified: false,
    });
  });
});
