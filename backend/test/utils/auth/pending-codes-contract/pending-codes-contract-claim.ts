import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { ReservedCode } from '../../../../src/auth/interfaces/pending-code.interface';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  CODE,
  CODE_LIFETIME_MS,
  contractServices,
  ContractServices,
  hashOf,
  HarnessSource,
  LIVE_EXPIRY,
  rejectionOf,
  rerunAtOnce,
} from './pending-codes-contract-support';

const EMAIL = 'activate@example.test';
const SIGNUP = PENDING_PURPOSE.SIGNUP;

/** Claiming a sign-up code once, inside the unit of work that uses it. */
export function registrationClaimCases(harness: HarnessSource): void {
  let services: ContractServices;

  beforeEach(async () => {
    services = await contractServices(harness());
  });

  afterEach(() => {
    services.restore();
  });

  const verify = (code: string) =>
    services.verification.verifyCode(EMAIL, code, SIGNUP);
  const seed = async (expiresAt: Date, attempts = 0): Promise<string> =>
    harness().seedRegistration({
      email: EMAIL,
      purpose: SIGNUP,
      hashedCode: await hashOf(CODE),
      attempts,
      expiresAt,
    });
  const claim = (reserved: ReservedCode): Promise<boolean> =>
    harness()
      .runner(rerunAtOnce)
      .run((unitOfWork) =>
        services.verification.consumeCode(reserved, unitOfWork),
      );

  it('lets one of two simultaneous claims of one code win', async () => {
    await seed(LIVE_EXPIRY);
    const first = await verify(CODE);
    const second = await verify(CODE);
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().stores.registrations,
      'claimCode',
      (call) => (call < 2 ? gate : undefined),
    );
    let claims: boolean[];
    try {
      const both = [claim(first), claim(second)];
      await gate.reached(2);
      gate.release();
      claims = await Promise.all(both);
    } finally {
      restore();
    }

    expect({
      won: claims.filter(Boolean).length,
      lost: claims.filter((claimed) => !claimed).length,
      rows: await harness().registrationCount(),
    }).toEqual({ won: 1, lost: 1, rows: 0 });
  });

  it('refuses a claim once the code has expired, though its row is still stored', async () => {
    await seed(LIVE_EXPIRY);
    const reserved = await verify(CODE);
    harness().clock.advance(CODE_LIFETIME_MS);

    const claimed = await claim(reserved);

    expect({ claimed, rows: await harness().registrationCount() }).toEqual({
      claimed: false,
      rows: 1,
    });
  });

  it('claims one millisecond before the code expires', async () => {
    await seed(LIVE_EXPIRY);
    const reserved = await verify(CODE);
    harness().clock.advance(CODE_LIFETIME_MS - 1);

    expect(await claim(reserved)).toBe(true);
  });

  it('refuses the claim of a code a resend replaced and keeps the new code usable', async () => {
    await seed(LIVE_EXPIRY);
    const stale = await verify(CODE);
    const reissued = await services.verification.resendActivationCode(
      EMAIL,
      SIGNUP,
    );

    const staleClaim = await claim(stale);
    const fresh = await verify(reissued?.code ?? '');
    const freshClaim = await claim(fresh);

    expect({ staleClaim, freshClaim }).toEqual({
      staleClaim: false,
      freshClaim: true,
    });
  });

  it('refuses a claim made for the other purpose', async () => {
    await seed(LIVE_EXPIRY);
    const reserved = await verify(CODE);

    const claimed = await claim({
      ...reserved,
      purpose: PENDING_PURPOSE.EMAIL_CHANGE,
    });

    expect({ claimed, rows: await harness().registrationCount() }).toEqual({
      claimed: false,
      rows: 1,
    });
  });

  it('puts the code back when the unit of work that claimed it fails', async () => {
    await seed(LIVE_EXPIRY);
    const reserved = await verify(CODE);
    const laterStep = new Error('the account write failed');

    const failure = await rejectionOf(
      harness()
        .runner(rerunAtOnce)
        .run(async (unitOfWork) => {
          const claimed = await services.verification.consumeCode(
            reserved,
            unitOfWork,
          );
          if (claimed) throw laterStep;
        }),
    );

    expect({
      rethrown: failure === laterStep,
      rows: await harness().registrationCount(),
      claimedAfter: await claim(reserved),
    }).toEqual({ rethrown: true, rows: 1, claimedAfter: true });
  });
}
