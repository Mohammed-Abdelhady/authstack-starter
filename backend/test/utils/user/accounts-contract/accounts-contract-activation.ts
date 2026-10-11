import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { createResponseMock } from '../../../../src/common/testing/test-doubles.harness-spec';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  AccountServices,
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  refusalOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const CODE_INVALID = { code: 'ACTIVATION_CODE_INVALID', status: 400 };
const RESPONSE: Response = createResponseMock({});
const PASSWORD = 'ActivatedPassword123!';

async function signUpCode(
  services: AccountServices,
  email: string,
): Promise<string> {
  const issued = await services.verification.createOrUpdatePendingRegistration(
    email,
    PENDING_PURPOSE.SIGNUP,
  );
  if (!issued) throw new Error('the sign-up code was not issued');
  return issued.code;
}

/** The six digits of the newest mail, which is the code it carries. */
function mailedCode(services: AccountServices): string {
  const last = services.mail[services.mail.length - 1];
  const code = /\b(\d{6})\b/.exec(`${last?.text ?? ''} ${last?.html ?? ''}`);
  if (!code) throw new Error('the last mail carried no code');
  return code[1];
}

/** Activating a sign-up and confirming an address an admin moved. */
export function accountActivationCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('activates a sign-up into a verified account and spends the code', async () => {
    const services = servicesOn(harness());
    const code = await signUpCode(services, 'new@example.test');

    const answer = await services.registration.activate(
      {
        email: 'new@example.test',
        code,
        password: PASSWORD,
        name: ' New One ',
      },
      RESPONSE,
    );

    const id = await harness().accountIdByEmail('new@example.test');
    expect(answer.data).toMatchObject({
      mustSignIn: false,
      requiresTwoFactor: false,
      user: { id, email: 'new@example.test', name: 'New One' },
    });
    const stored = await storedAccount(harness(), id ?? '');
    expect(stored).toMatchObject({
      name: 'New One',
      role: DEFAULT_SLUG,
      isVerified: true,
      isDeleted: false,
      authProvider: 'email',
      primaryProvider: 'email',
    });
    expect(await bcrypt.compare(PASSWORD, stored.passwordHash ?? '')).toBe(
      true,
    );
    expect(await harness().pendingRegistrations('new@example.test')).toBe(0);
    expect(
      await refusalOf(
        services.registration.activate(
          {
            email: 'new@example.test',
            code,
            password: PASSWORD,
            name: 'Again',
          },
          RESPONSE,
        ),
      ),
    ).toEqual(CODE_INVALID);
  });

  it('keeps the code when the address got an account first', async () => {
    const services = servicesOn(harness());
    const code = await signUpCode(services, 'raced@example.test');
    const beforeInsert = new RaceGate();
    const restore = holdBefore(
      harness().activation,
      'insertActivated',
      (call) => (call === 0 ? beforeInsert : undefined),
    );
    const refusal = refusalOf(
      services.registration.activate(
        {
          email: 'raced@example.test',
          code,
          password: PASSWORD,
          name: 'Late',
        },
        RESPONSE,
      ),
    );
    try {
      // The code is consumed inside the unit of work and the address was free.
      await beforeInsert.reached(1);
      await harness().seedAccount({
        email: 'raced@example.test',
        name: 'First',
        role: DEFAULT_SLUG,
      });
    } finally {
      beforeInsert.release();
      restore();
    }

    expect(await refusal).toEqual(CODE_INVALID);
    const winner = await harness().accountIdByEmail('raced@example.test');
    expect((await storedAccount(harness(), winner ?? '')).name).toBe('First');
    expect(await harness().pendingRegistrations('raced@example.test')).toBe(1);
  });

  it('refuses a sign-up code for an address that has an account', async () => {
    const services = servicesOn(harness());
    const code = await signUpCode(services, 'person@example.test');

    expect(
      await refusalOf(
        services.registration.activate(
          {
            email: 'person@example.test',
            code,
            password: PASSWORD,
            name: 'X',
          },
          RESPONSE,
        ),
      ),
    ).toEqual(CODE_INVALID);
    expect((await storedAccount(harness(), fixture().userId)).name).toBe(
      'Plain Person',
    );
    expect(await harness().pendingRegistrations('person@example.test')).toBe(1);
  });

  it('moves an address, leaves it unverified, and confirms it by code', async () => {
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
      email: 'moved@example.test',
      isVerified: false,
    });
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'moved@example.test',
      isVerified: false,
      addressGeneration: 1,
    });

    await services.emailChange.confirm({
      email: 'moved@example.test',
      code: mailedCode(services),
    });

    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'moved@example.test',
      isVerified: true,
      addressGeneration: 1,
    });
    expect(await harness().pendingRegistrations('moved@example.test')).toBe(0);
  });

  it('confirms nothing with the code of a superseded move', async () => {
    const { userId, adminId } = fixture();
    const services = servicesOn(harness());
    const move = (email: string): Promise<unknown> =>
      services.adminUsers.updateUser(userId, { email }, adminId, ADMIN_SLUG);
    await move('first-move@example.test');
    const firstCode = mailedCode(services);
    await move('second-move@example.test');

    expect(
      await refusalOf(
        services.emailChange.confirm({
          email: 'first-move@example.test',
          code: firstCode,
        }),
      ),
    ).toEqual(CODE_INVALID);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'second-move@example.test',
      isVerified: false,
      addressGeneration: 2,
    });
    // The refused confirmation put its code back.
    expect(
      await harness().pendingRegistrations('first-move@example.test'),
    ).toBe(1);
  });

  it('confirms nothing with a code issued under another address generation', async () => {
    const { userId } = fixture();
    await harness().alterAccount(userId, { verified: false });
    const services = servicesOn(harness());
    // The account is at generation 0. This code belongs to generation 5.
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
    expect((await storedAccount(harness(), userId)).isVerified).toBe(false);
  });
}
