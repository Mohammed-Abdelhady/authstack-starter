import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { CLAIM_OWNER, holdAddress } from '../../address-claim';
import { AccountCreationPolicy } from '../../../../src/auth/services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../../../src/auth/constants/account-creation';
import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { createResponseMock } from '../../../../src/common/testing/test-doubles.harness-spec';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  AccountServices,
  AccountsFixture,
  AccountsHarnessSource,
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

/** Sign-up activation through the code sent to a new address. */
export function accountActivationCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('activates a sign-up into a verified account and spends the code', async () => {
    const policy = new AccountCreationPolicy();
    const check = jest.spyOn(policy, 'assertMayCreate');
    const inserting = jest.spyOn(harness().activation, 'insertActivated');
    const services = servicesOn(harness(), undefined, policy);
    const code = await signUpCode(services, 'new@example.test');

    const answer = await services.registration.activate(
      {
        email: 'new@example.test',
        code,
        password: PASSWORD,
        name: ' New One ',
      },
      RESPONSE,
      'en',
    );

    expect(check.mock.calls).toEqual([
      [
        {
          application: WEB_CLIENT_ID,
          method: ACCOUNT_CREATION_METHOD.PASSWORD,
        },
        inserting.mock.calls[0]?.[0],
      ],
    ]);
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
          'en',
        ),
      ),
    ).toEqual(CODE_INVALID);
  });

  it('L1 refuses activation on a live claim without spending its code', async () => {
    const h = harness();
    const services = servicesOn(h);
    const email = 'held-activation@example.test';
    const code = await signUpCode(services, email);
    await holdAddress(
      h.ledger,
      h.runner(() => Promise.resolve()),
      h.clock,
      email,
    );
    expect(
      await refusalOf(
        services.registration.activate(
          {
            email,
            code,
            password: PASSWORD,
            name: 'Refused',
          },
          RESPONSE,
          'en',
        ),
      ),
    ).toEqual(CODE_INVALID);
    expect(await h.accountIdByEmail(email)).toBeNull();
    expect(await h.pendingRegistrations(email)).toBe(1);
    expect((await h.claims()).map((row) => row.owner)).toEqual([CLAIM_OWNER]);
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
        'en',
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
          'en',
        ),
      ),
    ).toEqual(CODE_INVALID);
    expect((await storedAccount(harness(), fixture().userId)).name).toBe(
      'Plain Person',
    );
    expect(await harness().pendingRegistrations('person@example.test')).toBe(1);
  });
}
