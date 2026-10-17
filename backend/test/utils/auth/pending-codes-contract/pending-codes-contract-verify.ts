import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { TEST_NOW } from '../../frozen-clock';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  CODE,
  codeOf,
  contractServices,
  ContractServices,
  EXPIRED_EXPIRY,
  hashOf,
  GUESS_RULE,
  HarnessSource,
  LIVE_EXPIRY,
  MAX_ATTEMPTS,
  rejectionOf,
  WRONG_CODE,
} from './pending-codes-contract-support';

const EMAIL = 'activate@example.test';
const SIGNUP = PENDING_PURPOSE.SIGNUP;
const INVALID = 'ACTIVATION_CODE_INVALID';

/** Reserving an attempt on a sign-up code and comparing it once. */
export function registrationVerifyCases(harness: HarnessSource): void {
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
  const attempts = async () =>
    (await harness().registration(EMAIL, SIGNUP))?.attempts;

  it('returns the stored record for the right code after counting one attempt', async () => {
    const id = await seed(LIVE_EXPIRY, 2);

    const reserved = await verify(CODE);

    expect({
      id: reserved.id,
      idType: typeof reserved.id,
      email: reserved.email,
      purpose: reserved.purpose,
      attempts: await attempts(),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      id,
      idType: 'string',
      email: EMAIL,
      purpose: 'signup',
      attempts: 3,
      calls: ['registration.reserveAttempt'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it('counts a wrong attempt once and compares once', async () => {
    await seed(LIVE_EXPIRY);

    const failure = await rejectionOf(verify(WRONG_CODE));

    expect({
      code: codeOf(failure),
      attempts: await attempts(),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      code: INVALID,
      attempts: 1,
      calls: ['registration.reserveAttempt'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it('refuses the right code once the cap is reached and counts no further attempt', async () => {
    await seed(LIVE_EXPIRY);
    const wrong: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      wrong.push(codeOf(await rejectionOf(verify(WRONG_CODE))));
    }
    const atCap = await attempts();
    services.clear();

    const failure = await rejectionOf(verify(CODE));

    expect({
      wrong,
      atCap,
      code: codeOf(failure),
      attempts: await attempts(),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      wrong: [INVALID, INVALID, INVALID, INVALID, INVALID],
      atCap: 5,
      code: INVALID,
      attempts: 5,
      calls: ['registration.reserveAttempt', 'registration.dropExpiredRecord'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it('admits the last attempt under the cap', async () => {
    await seed(LIVE_EXPIRY, MAX_ATTEMPTS - 1);

    const reserved = await verify(CODE);

    expect({ email: reserved.email, attempts: await attempts() }).toEqual({
      email: EMAIL,
      attempts: 5,
    });
  });

  it('answers an address with no record the same way, with one comparison', async () => {
    const failure = await rejectionOf(verify(CODE));

    expect({
      code: codeOf(failure),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      code: INVALID,
      calls: ['registration.reserveAttempt', 'registration.dropExpiredRecord'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it('does not reserve an attempt on an expired record that is still stored', async () => {
    await seed(TEST_NOW);

    const reserved = await harness().stores.registrations.reserveAttempt(
      { email: EMAIL, purpose: SIGNUP },
      { now: TEST_NOW, maxAttempts: MAX_ATTEMPTS, guesses: GUESS_RULE },
    );

    expect({ reserved, attempts: await attempts() }).toEqual({
      reserved: null,
      attempts: 0,
    });
  });

  it('refuses the right code of an expired record, compares once and drops the record', async () => {
    await seed(EXPIRED_EXPIRY);

    const failure = await rejectionOf(verify(CODE));

    expect({
      code: codeOf(failure),
      rows: await harness().registrationCount(),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      code: INVALID,
      rows: 0,
      calls: ['registration.reserveAttempt', 'registration.dropExpiredRecord'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it('stops simultaneous wrong attempts at the cap', async () => {
    await seed(LIVE_EXPIRY);
    const racers = MAX_ATTEMPTS + 2;
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().stores.registrations,
      'reserveAttempt',
      () => gate,
    );
    let codes: string[];
    try {
      const all = Array.from({ length: racers }, () =>
        rejectionOf(verify(WRONG_CODE)),
      );
      await gate.reached(racers);
      gate.release();
      codes = (await Promise.all(all)).map(codeOf);
    } finally {
      restore();
    }

    expect({
      refused: codes.filter((code) => code === INVALID).length,
      attempts: await attempts(),
    }).toEqual({ refused: 7, attempts: 5 });
  });
}
