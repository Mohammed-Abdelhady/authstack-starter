import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SEED_ADMIN } from '../constants/seed-users';
import type { ApiBody } from '../types/e2e-responses';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { RaceGate } from '../utils/race-gate';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface AdminUserBody {
  email: string;
  pendingEmail?: string;
  isVerified: boolean;
}

const OLD = 'race-owner@example.test';
const FIRST = 'first-choice@example.test';
const SECOND = 'second-choice@example.test';

describe('admin pending-address races (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;
  let targetId: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(new Date('2098-01-01T00:00:00.000Z'));
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    ({ _id: targetId } = await e2e.state.accounts.createAccount({
      email: OLD,
      name: 'Address Race',
      role: UserRole.USER,
      isVerified: true,
      addressGeneration: 0,
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  function move(email: string) {
    return admin.patch(`/api/admin/users/${targetId}`).send({ email });
  }

  async function stored() {
    const account = await e2e.state.accounts.accountWithId(targetId);
    return {
      email: account?.email,
      pendingEmail: account?.pendingEmail,
      addressGeneration: account?.addressGeneration,
      isVerified: account?.isVerified,
    };
  }

  async function confirm(email: string, code: string) {
    const agent = await browserAgent(e2e.httpServer);
    return agent.post('/api/auth/confirm-email-change').send({ email, code });
  }

  async function mailCount(email: string): Promise<number> {
    return (await e2e.captureMail()).filter((mail) => mail.to === email).length;
  }

  it('rejects the older request code after a later request is committed', async () => {
    await move(FIRST).expect(200);
    const oldCode = await e2e.mailedCode();
    await move(SECOND).expect(200);
    const newCode = await e2e.mailedCode();

    expect((await confirm(FIRST, oldCode)).status).toBe(400);
    expect(await stored()).toEqual({
      email: OLD,
      pendingEmail: SECOND,
      addressGeneration: 2,
      isVerified: true,
    });
    expect((await confirm(SECOND, newCode)).status).toBe(200);
    expect((await stored()).email).toBe(SECOND);
  });

  it('allocates different generations to requests racing from the same state', async () => {
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const accounts = e2e.app.get(AdminAccountStore);
    const takeAccount = accounts.takeAccountForChange.bind(accounts);
    let arrivals = 0;
    const spy = jest
      .spyOn(accounts, 'takeAccountForChange')
      .mockImplementation(async (unitOfWork, id) => {
        const gate = arrivals++ === 0 ? firstGate : secondGate;
        await gate.hold();
        return takeAccount(unitOfWork, id);
      });

    const firstRequest = Promise.resolve(move(FIRST));
    const secondRequest = Promise.resolve(move(SECOND));
    try {
      await Promise.all([firstGate.reached(), secondGate.reached()]);
      firstGate.release();
      const firstSettled = firstRequest.then((response) => ({
        name: 'first' as const,
        response,
      }));
      const secondSettled = secondRequest.then((response) => ({
        name: 'second' as const,
        response,
      }));
      const winner = await Promise.race([firstSettled, secondSettled]);
      secondGate.release();
      const loser =
        winner.name === 'first' ? await secondRequest : await firstRequest;

      expect(winner.response.status).toBe(200);
      expect(loser.status).toBe(409);
      const pendingEmail = (winner.response.body as ApiBody<AdminUserBody>).data
        .pendingEmail;
      expect([FIRST, SECOND]).toContain(pendingEmail);
      const losingEmail = pendingEmail === FIRST ? SECOND : FIRST;
      expect(await stored()).toEqual({
        email: OLD,
        pendingEmail,
        addressGeneration: 1,
        isVerified: true,
      });
      expect(await mailCount(pendingEmail ?? '')).toBe(1);
      expect(await mailCount(losingEmail)).toBe(0);

      expect(
        (await confirm(pendingEmail ?? '', await e2e.mailedCode())).status,
      ).toBe(200);
      expect((await stored()).email).toBe(pendingEmail);
    } finally {
      firstGate.release();
      secondGate.release();
      spy.mockRestore();
    }
  });
});
