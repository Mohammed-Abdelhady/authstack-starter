import { CLAIM_OWNER, holdAddress } from '../../address-claim';
import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  refusalOf,
  servicesOn,
  storedAccount,
  lastMailedCode as mailedCode,
} from './accounts-contract-support';

const CODE_INVALID = { code: 'ACTIVATION_CODE_INVALID', status: 400 };

export function accountEmailConfirmationCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('keeps the address until the code confirms the new one, then moves it', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());

    const moved = await services.adminUsers.updateUser(
      userId,
      { email: 'Moved@Example.Test' },
      adminId,
      ADMIN_SLUG,
    );

    expect(moved.data).toMatchObject({
      id: userId,
      email: 'person@example.test',
      pendingEmail: 'moved@example.test',
    });
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: 'moved@example.test',
      isVerified: true,
      addressGeneration: 1,
    });

    await services.emailChange.confirm({
      email: 'moved@example.test',
      code: mailedCode(services),
    });

    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'moved@example.test',
      pendingEmail: null,
      isVerified: true,
      addressGeneration: 1,
    });
    expect(await harness().pendingRegistrations('moved@example.test')).toBe(0);
    expect(await harness().claims()).toEqual([]);
    expect(
      await harness()
        .runner(() => Promise.resolve())
        .run((uow) =>
          harness().ledger.isFree(uow, {
            address: 'person@example.test',
            now: harness().clock.now(),
          }),
        ),
    ).toBe(true);
  });

  it('confirms nothing with the code of a superseded move', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    const move = (email: string): Promise<unknown> =>
      services.adminUsers.updateUser(userId, { email }, adminId, ADMIN_SLUG);
    await move('first-move@example.test');
    const firstCode = mailedCode(services);
    await move('second-move@example.test');
    expect((await harness().claims()).map((row) => row.address)).toEqual([
      'second-move@example.test',
    ]);

    expect(
      await refusalOf(
        services.emailChange.confirm({
          email: 'first-move@example.test',
          code: firstCode,
        }),
      ),
    ).toEqual(CODE_INVALID);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      isVerified: true,
      addressGeneration: 2,
    });
    expect(
      await harness().pendingRegistrations('first-move@example.test'),
    ).toBe(1);
  });

  it('refuses another address bound to the same generation', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    await services.adminUsers.updateUser(
      userId,
      { email: 'current-choice@example.test' },
      adminId,
      ADMIN_SLUG,
    );
    const stale = await services.verification.createOrUpdatePendingRegistration(
      'losing-choice@example.test',
      PENDING_PURPOSE.EMAIL_CHANGE,
      { userId, addressGeneration: 1 },
    );
    if (!stale) throw new Error('the competing code was not issued');

    expect(
      await refusalOf(
        services.emailChange.confirm({
          email: 'losing-choice@example.test',
          code: stale.code,
        }),
      ),
    ).toEqual(CODE_INVALID);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: 'current-choice@example.test',
      addressGeneration: 1,
    });
  });

  // Neither a current account nor another live claim may be displaced by a code.
  it.each(['account', 'claim'])(
    'keeps the pending code when another owner holds the address by %s',
    async (mode) => {
      const { userId, adminId } = fixture();
      const services = servicesOn(harness());
      const requested = 'claimed-after-request@example.test';
      await services.adminUsers.updateUser(
        userId,
        { email: requested },
        adminId,
        ADMIN_SLUG,
      );
      const code = mailedCode(services);
      let claimantId: string | null = null;
      if (mode === 'account') {
        claimantId = await harness().seedAccount({
          email: requested,
          role: DEFAULT_SLUG,
        });
      } else {
        const h = harness();
        await h
          .runner(() => Promise.resolve())
          .run((uow) =>
            h.ledger.release(uow, { address: requested, owner: userId }),
          );
        await holdAddress(
          h.ledger,
          h.runner(() => Promise.resolve()),
          h.clock,
          requested,
        );
      }

      expect(
        await refusalOf(
          services.emailChange.confirm({ email: requested, code }),
        ),
      ).toEqual(CODE_INVALID);
      expect(await storedAccount(harness(), userId)).toMatchObject({
        email: 'person@example.test',
        pendingEmail: requested,
        isVerified: true,
        addressGeneration: 1,
      });
      expect(await harness().accountIdByEmail(requested)).toBe(claimantId);
      expect(await harness().pendingRegistrations(requested)).toBe(1);
      if (mode === 'claim') {
        expect((await harness().claims()).map((row) => row.owner)).toEqual([
          CLAIM_OWNER,
        ]);
      }
    },
  );

  it('confirms nothing with a code issued under another address generation', async () => {
    const { userId } = fixture();
    await harness().alterAccount(userId, { verified: false });
    const services = servicesOn(harness());
    const issued =
      await services.verification.createOrUpdatePendingRegistration(
        'person@example.test',
        PENDING_PURPOSE.EMAIL_CHANGE,
        { userId, addressGeneration: 5 },
      );
    if (!issued) throw new Error('the code was not issued');

    expect(
      await refusalOf(
        services.emailChange.confirm({
          email: 'person@example.test',
          code: issued.code,
        }),
      ),
    ).toEqual(CODE_INVALID);
    expect((await storedAccount(harness(), userId)).isVerified).toBe(false);
  });

  it('refuses to move an account onto a taken address', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());

    expect(
      await refusalOf(
        services.adminUsers.updateUser(
          userId,
          { email: 'manager@example.test' },
          adminId,
          ADMIN_SLUG,
        ),
      ),
    ).toEqual({ code: 'EMAIL_ALREADY_EXISTS', status: 409 });
    expect(services.mail).toEqual([]);
    await holdAddress(
      harness().ledger,
      harness().runner(() => Promise.resolve()),
      harness().clock,
      'held-edit@example.test',
    );
    expect(
      await refusalOf(
        services.adminUsers.updateUser(
          userId,
          { email: 'held-edit@example.test' },
          adminId,
          ADMIN_SLUG,
        ),
      ),
    ).toEqual({ code: 'EMAIL_ALREADY_EXISTS', status: 409 });
    expect(services.mail).toEqual([]);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      isVerified: true,
      addressGeneration: 0,
    });
  });

  it('refuses a move prepared for an address that changed meanwhile', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    const admitted = new RaceGate();
    const restore = holdBefore(
      harness().admin,
      'takeAccountForChange',
      (call) => (call === 0 ? admitted : undefined),
    );
    const refusal = refusalOf(
      services.adminUsers.updateUser(
        userId,
        { email: 'prepared@example.test' },
        adminId,
        ADMIN_SLUG,
      ),
    );
    try {
      await admitted.reached(1);
      await harness().alterAccount(userId, {
        email: 'elsewhere@example.test',
      });
    } finally {
      admitted.release();
      restore();
    }

    expect(await refusal).toEqual({ code: 'CONFLICT', status: 409 });
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'elsewhere@example.test',
      isVerified: true,
      addressGeneration: 0,
    });
  });

  it('does not confirm a move for a deactivated account', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    await services.adminUsers.updateUser(
      userId,
      { email: 'gone@example.test' },
      adminId,
      ADMIN_SLUG,
    );
    await harness().alterAccount(userId, { deleted: true });

    expect(
      await refusalOf(
        services.emailChange.confirm({
          email: 'gone@example.test',
          code: mailedCode(services),
        }),
      ),
    ).toEqual(CODE_INVALID);
    const stored = await storedAccount(harness(), userId);
    expect(stored.email).toBe('person@example.test');
  });
}
