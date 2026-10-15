import { accountClaimRefreshCases } from './accounts-contract-claim-refresh';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { RaceGate, holdBefore } from '../../race-gate';
import {
  ADMIN_SLUG,
  lastMailedCode,
  AccountsHarnessSource,
  AccountsFixture,
  answerOf,
  refusalOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const FIRST_ADDRESS = 'first-pending@example.test';
const SECOND_ADDRESS = 'second-pending@example.test';

export function accountPendingEmailCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('keeps the current address active until the pending mailbox confirms', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());

    const result = await services.adminUsers.updateUser(
      userId,
      { email: FIRST_ADDRESS },
      adminId,
      ADMIN_SLUG,
    );

    expect(result.data.email).toBe('person@example.test');
    expect(result.data.pendingEmail).toBe(FIRST_ADDRESS);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: FIRST_ADDRESS,
      isVerified: true,
      addressGeneration: 1,
    });
    expect(services.mail.map((message) => message.to)).toEqual([
      'person@example.test',
      FIRST_ADDRESS,
    ]);
    expect(await harness().pendingRegistrations(FIRST_ADDRESS)).toBe(1);
  });

  it('keeps sessions during the wait and revokes them on confirmation', async () => {
    const { userId, adminId } = fixture();
    const sessionId = await harness().seedSession(userId);
    const services = servicesOn(harness());
    await services.adminUsers.updateUser(
      userId,
      { email: FIRST_ADDRESS },
      adminId,
      ADMIN_SLUG,
    );

    expect(await harness().liveSessionIds(userId)).toContain(sessionId);
    await services.emailChange.confirm({
      email: FIRST_ADDRESS,
      code: lastMailedCode(services),
    });

    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: FIRST_ADDRESS,
      pendingEmail: null,
      isVerified: true,
      addressGeneration: 1,
    });
    expect(await harness().liveSessionIds(userId)).toEqual([]);
  });

  it('rejects an active address regardless of letter case', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());

    expect(
      await refusalOf(
        services.adminUsers.updateUser(
          userId,
          { email: 'Manager@Example.Test' },
          adminId,
          ADMIN_SLUG,
        ),
      ),
    ).toMatchObject({ code: ErrorCode.EMAIL_ALREADY_EXISTS, status: 409 });
    expect(services.mail).toEqual([]);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: null,
      isVerified: true,
      addressGeneration: 0,
    });
  });

  it('lets only the account write winner issue a code for concurrent requests', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const restore = holdBefore(
      harness().admin,
      'takeAccountForChange',
      (call) => (call === 0 ? firstGate : call === 1 ? secondGate : undefined),
    );
    const first = services.adminUsers.updateUser(
      userId,
      { email: FIRST_ADDRESS },
      adminId,
      ADMIN_SLUG,
    );
    const second = services.adminUsers.updateUser(
      userId,
      { email: SECOND_ADDRESS },
      adminId,
      ADMIN_SLUG,
    );

    try {
      await Promise.all([firstGate.reached(), secondGate.reached()]);
      firstGate.release();
      const firstCompletion = first.then(() => 'first' as const);
      const secondCompletion = second.then(() => 'second' as const);
      const winner = await Promise.race([firstCompletion, secondCompletion]);
      secondGate.release();

      const outcomes = await Promise.allSettled([first, second]);
      const successes = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const failures = outcomes.filter(
        (outcome) => outcome.status === 'rejected',
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      if (failures[0].status === 'rejected') {
        expect(answerOf(failures[0].reason)).toMatchObject({
          code: ErrorCode.CONFLICT,
          status: 409,
        });
      }

      const winningAddress =
        winner === 'first' ? FIRST_ADDRESS : SECOND_ADDRESS;
      const losingAddress = winner === 'first' ? SECOND_ADDRESS : FIRST_ADDRESS;
      expect(await storedAccount(harness(), userId)).toMatchObject({
        email: 'person@example.test',
        pendingEmail: winningAddress,
        isVerified: true,
        addressGeneration: 1,
      });
      expect(services.mail.map((message) => message.to)).toEqual([
        'person@example.test',
        winningAddress,
      ]);
      expect(await harness().pendingRegistrations(winningAddress)).toBe(1);
      expect(await harness().pendingRegistrations(losingAddress)).toBe(0);
    } finally {
      firstGate.release();
      secondGate.release();
      restore();
    }
  });

  it('does not confirm an older address when an admin request commits first', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    const issueCode = jest.spyOn(services.verification, 'prepareEmailChange');
    await services.adminUsers.updateUser(
      userId,
      { email: FIRST_ADDRESS },
      adminId,
      ADMIN_SLUG,
    );
    const oldCode = lastMailedCode(services);
    const confirmationGate = new RaceGate();
    const verifyCode = services.verification.verifyCode.bind(
      services.verification,
    );
    jest
      .spyOn(services.verification, 'verifyCode')
      .mockImplementation(async (email, code, purpose) => {
        const reserved = await verifyCode(email, code, purpose);
        await confirmationGate.hold();
        return reserved;
      });
    const confirmation = services.emailChange.confirm({
      email: FIRST_ADDRESS,
      code: oldCode,
    });

    try {
      await confirmationGate.reached(1);
      await services.adminUsers.updateUser(
        userId,
        { email: SECOND_ADDRESS },
        adminId,
        ADMIN_SLUG,
      );
      confirmationGate.release();

      expect(await refusalOf(confirmation)).toMatchObject({
        code: ErrorCode.ACTIVATION_CODE_INVALID,
        status: 400,
      });
      expect(await storedAccount(harness(), userId)).toMatchObject({
        email: 'person@example.test',
        pendingEmail: SECOND_ADDRESS,
        isVerified: true,
        addressGeneration: 2,
      });
      expect(services.mail.map((message) => message.to)).toEqual([
        'person@example.test',
        FIRST_ADDRESS,
        'person@example.test',
        SECOND_ADDRESS,
      ]);
      expect(issueCode.mock.calls.map(([address]) => address)).toEqual([
        FIRST_ADDRESS,
        SECOND_ADDRESS,
      ]);
      expect(await harness().pendingRegistrations(FIRST_ADDRESS)).toBe(1);
      expect(await harness().pendingRegistrations(SECOND_ADDRESS)).toBe(1);
    } finally {
      confirmationGate.release();
    }
  });
  accountClaimRefreshCases(harness, fixture);
}
