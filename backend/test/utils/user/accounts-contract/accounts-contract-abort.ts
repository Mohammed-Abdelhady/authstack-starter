import * as bcrypt from 'bcrypt';
import { failAfter } from '../../session/authority-contract/authority-contract-support';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  AccountsFixture,
  AccountsHarnessSource,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  MANAGER_SLUG,
  NEW_PASSWORD,
  OLD_PASSWORD,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const SESSION_ISSUED = 'session_issued';
const ABORTED_AFTER_THE_EVENT = 'the work was aborted after the sign-out event';

/**
 * Every account change that signs the account out, aborted once the sign-out
 * and its event are written: the change, the sign-out and the event must all
 * be gone. A refused event would not prove this, because a refusal fails the
 * work wherever the event is written.
 */
export function accountAbortCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  const failure = new Error(ABORTED_AFTER_THE_EVENT);
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  /** Two live sessions of the plain account, in the order a read lists them. */
  async function twoSessions(): Promise<{ kept: string; live: string[] }> {
    const { userId } = fixture();
    const kept = await harness().seedSession(userId);
    const other = await harness().seedSession(userId);
    return { kept, live: [kept, other].sort() };
  }

  /** What is stored for the plain account after the aborted work. */
  async function stored(raised: unknown) {
    const { userId } = fixture();
    const account = await storedAccount(harness(), userId);
    const events = await harness().events();
    return {
      raisedTheAbort: raised === failure,
      role: account.role,
      isDeleted: account.isDeleted,
      deletedAt: account.deletedAt,
      oldPasswordStillOpens: await bcrypt.compare(
        OLD_PASSWORD,
        account.passwordHash ?? '',
      ),
      sessionVersion: account.sessionVersion,
      live: await harness().liveSessionIds(userId),
      // Seeding a session records its own event on one database.
      events: events
        .filter((event) => event.action !== SESSION_ISSUED)
        .map((event) => event.action),
    };
  }

  function unchanged(live: string[]) {
    return {
      raisedTheAbort: true,
      role: DEFAULT_SLUG,
      isDeleted: false,
      deletedAt: null,
      oldPasswordStillOpens: true,
      sessionVersion: 0,
      live,
      events: [],
    };
  }

  it('stores nothing of a password change aborted after its sign-out event', async () => {
    const { userId } = fixture();
    const { kept, live } = await twoSessions();
    restore = failAfter(harness().sessions, 'revokeAllExcept', failure);

    const raised = await rejectionOf(
      servicesOn(harness()).profile.changePassword(
        userId,
        { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
        kept,
      ),
    );

    expect(await stored(raised)).toEqual(unchanged(live));
  });

  it('stores nothing of leaving aborted after its sign-out event', async () => {
    const { userId } = fixture();
    const { live } = await twoSessions();
    restore = failAfter(harness().sessions, 'revokeAll', failure);

    const raised = await rejectionOf(
      servicesOn(harness()).profile.deactivateAccount(userId),
    );

    expect(await stored(raised)).toEqual(unchanged(live));
  });

  it('stores nothing of an admin deactivation aborted after its sign-out event', async () => {
    const { userId, managerId } = fixture();
    const { live } = await twoSessions();
    restore = failAfter(harness().sessions, 'revokeAll', failure);

    const raised = await rejectionOf(
      servicesOn(harness()).adminUsers.updateUserStatus(
        userId,
        { isActive: false },
        managerId,
      ),
    );

    expect(await stored(raised)).toEqual(unchanged(live));
  });

  it('stores nothing of an admin deletion aborted after its sign-out event', async () => {
    const { userId, managerId } = fixture();
    const { live } = await twoSessions();
    restore = failAfter(harness().sessions, 'revokeAll', failure);

    const raised = await rejectionOf(
      servicesOn(harness()).adminUsers.deleteUser(userId, managerId),
    );

    expect(await stored(raised)).toEqual(unchanged(live));
  });

  it('stores nothing of a role change aborted after its sign-out event', async () => {
    const { userId, managerId } = fixture();
    const { live } = await twoSessions();
    restore = failAfter(harness().sessions, 'revokeAll', failure);

    const raised = await rejectionOf(
      servicesOn(harness()).adminUsers.updateUserRole(
        userId,
        { role: EDITOR_SLUG },
        managerId,
        MANAGER_SLUG,
      ),
    );

    expect(await stored(raised)).toEqual(unchanged(live));
  });
}
