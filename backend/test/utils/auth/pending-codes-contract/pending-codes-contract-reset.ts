import { TEST_NOW } from '../../frozen-clock';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  CODE,
  CODE_LIFETIME_MS,
  codeOf,
  contractServices,
  ContractServices,
  EXPIRED_EXPIRY,
  hashOf,
  HarnessSource,
  LIVE_EXPIRY,
  matches,
  MAX_ATTEMPTS,
  rejectionOf,
  WRONG_CODE,
} from './pending-codes-contract-support';

const EMAIL = 'reset@example.test';
const INVALID = 'PASSWORD_RESET_CODE_INVALID';
const NEW_EXPIRY = new Date('2099-01-01T12:15:00.000Z');

/** Opening, comparing and spending a password reset code. */
export function passwordResetCases(harness: HarnessSource): void {
  let services: ContractServices;

  beforeEach(async () => {
    services = await contractServices(harness());
  });

  afterEach(() => {
    services.restore();
  });

  const open = () => services.passwordReset.createOrUpdatePasswordReset(EMAIL);
  const verify = (code: string) =>
    services.passwordReset.verifyPasswordReset(EMAIL, code);
  const seed = async (expiresAt: Date, attempts = 0): Promise<string> =>
    harness().seedPasswordReset({
      email: EMAIL,
      hashedCode: await hashOf(CODE),
      attempts,
      expiresAt,
    });
  const stored = async () => {
    const record = await harness().passwordReset(EMAIL);
    if (!record) throw new Error('expected a stored reset');
    return record;
  };

  it('stores a record for an address that has none, with one hash', async () => {
    const code = await open();
    const record = await stored();

    expect({
      codeIsStored: await matches(code, record.hashedCode),
      attempts: record.attempts,
      expiresAt: record.expiresAt,
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      codeIsStored: true,
      attempts: 0,
      expiresAt: NEW_EXPIRY,
      calls: ['reset.rotateCode', 'reset.insertRecord'],
      work: { hashes: 1, comparisons: 0 },
    });
  });

  it.each([
    ['live', LIVE_EXPIRY],
    ['expired and still stored', EXPIRED_EXPIRY],
  ] as const)(
    'gives a %s record a new code, zero attempts and a new expiry',
    async (_, expiresAt) => {
      const id = await seed(expiresAt, 4);

      const code = await open();
      const record = await stored();

      expect({
        sameRow: record.id === id,
        newCodeIsStored: await matches(code, record.hashedCode),
        oldCodeIsStored: await matches(CODE, record.hashedCode),
        attempts: record.attempts,
        expiresAt: record.expiresAt,
        calls: services.storeCalls,
      }).toEqual({
        sameRow: true,
        newCodeIsStored: true,
        oldCodeIsStored: false,
        attempts: 0,
        expiresAt: NEW_EXPIRY,
        calls: ['reset.rotateCode'],
      });
    },
  );

  it('updates the record that won when two requests store one at once', async () => {
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const restore = holdBefore(
      harness().stores.passwordResets,
      'insertRecord',
      (call) => [firstGate, secondGate][call],
    );
    let codes: string[];
    try {
      const first = open();
      await firstGate.reached(1);
      const second = open();
      await secondGate.reached(1);

      firstGate.release();
      const firstCode = await first;
      secondGate.release();
      codes = [firstCode, await second];
    } finally {
      restore();
    }
    const record = await stored();

    expect({
      rows: await harness().passwordResetCount(),
      firstIsStored: await matches(codes[0], record.hashedCode),
      secondIsStored: await matches(codes[1], record.hashedCode),
    }).toEqual({
      rows: 1,
      firstIsStored: codes[0] === codes[1],
      secondIsStored: true,
    });
  });

  it('returns the stored record for the right code after counting one attempt', async () => {
    const id = await seed(LIVE_EXPIRY, 1);

    const reserved = await verify(CODE);

    expect({
      id: reserved.id,
      attempts: (await stored()).attempts,
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      id,
      attempts: 2,
      calls: ['reset.reserveAttempt'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it('refuses the right code once the cap is reached and counts no further attempt', async () => {
    await seed(LIVE_EXPIRY);
    const wrong: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      wrong.push(codeOf(await rejectionOf(verify(WRONG_CODE))));
    }
    services.clear();

    const failure = await rejectionOf(verify(CODE));

    expect({
      wrong,
      code: codeOf(failure),
      attempts: (await stored()).attempts,
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      wrong: [INVALID, INVALID, INVALID, INVALID, INVALID],
      code: INVALID,
      attempts: 5,
      calls: ['reset.reserveAttempt', 'reset.dropExpiredRecord'],
      work: { hashes: 0, comparisons: 1 },
    });
  });

  it.each([
    ['an address with no record', undefined, 0],
    ['an expired record that is still stored', TEST_NOW, 0],
  ] as const)(
    'refuses the right code for %s with one comparison',
    async (_, expiresAt, rowsLeft) => {
      if (expiresAt) await seed(expiresAt);

      const failure = await rejectionOf(verify(CODE));

      expect({
        code: codeOf(failure),
        rows: await harness().passwordResetCount(),
        calls: services.storeCalls,
        work: services.hashWork(),
      }).toEqual({
        code: INVALID,
        rows: rowsLeft,
        calls: ['reset.reserveAttempt', 'reset.dropExpiredRecord'],
        work: { hashes: 0, comparisons: 1 },
      });
    },
  );

  it('does not reserve an attempt on an expired record that is still stored', async () => {
    await seed(TEST_NOW);

    const reserved = await harness().stores.passwordResets.reserveAttempt(
      EMAIL,
      { now: TEST_NOW, maxAttempts: MAX_ATTEMPTS },
    );

    expect({ reserved, attempts: (await stored()).attempts }).toEqual({
      reserved: null,
      attempts: 0,
    });
  });

  it('stops simultaneous wrong attempts at the cap', async () => {
    await seed(LIVE_EXPIRY);
    const racers = MAX_ATTEMPTS + 2;
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().stores.passwordResets,
      'reserveAttempt',
      () => gate,
    );
    try {
      const all = Array.from({ length: racers }, () =>
        rejectionOf(verify(WRONG_CODE)),
      );
      await gate.reached(racers);
      gate.release();
      await Promise.all(all);
    } finally {
      restore();
    }

    expect((await stored()).attempts).toBe(5);
  });

  it('lets one of two simultaneous claims of one code win', async () => {
    await seed(LIVE_EXPIRY);
    const first = await verify(CODE);
    const second = await verify(CODE);
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().stores.passwordResets,
      'claimCode',
      () => gate,
    );
    let claims: boolean[];
    try {
      const both = [
        services.passwordReset.consumePasswordReset(first.id, first.hashedCode),
        services.passwordReset.consumePasswordReset(
          second.id,
          second.hashedCode,
        ),
      ];
      await gate.reached(2);
      gate.release();
      claims = await Promise.all(both);
    } finally {
      restore();
    }

    expect({
      won: claims.filter(Boolean).length,
      rows: await harness().passwordResetCount(),
    }).toEqual({ won: 1, rows: 0 });
  });

  it('refuses a claim once the code has expired, though its row is still stored', async () => {
    await seed(LIVE_EXPIRY);
    const reserved = await verify(CODE);
    harness().clock.advance(CODE_LIFETIME_MS);

    const claimed = await services.passwordReset.consumePasswordReset(
      reserved.id,
      reserved.hashedCode,
    );

    expect({ claimed, rows: await harness().passwordResetCount() }).toEqual({
      claimed: false,
      rows: 1,
    });
  });

  it('refuses the claim of a code a new request replaced and keeps the new code usable', async () => {
    await seed(LIVE_EXPIRY);
    const stale = await verify(CODE);
    const reissued = await open();

    const staleClaim = await services.passwordReset.consumePasswordReset(
      stale.id,
      stale.hashedCode,
    );
    const fresh = await verify(reissued);
    const freshClaim = await services.passwordReset.consumePasswordReset(
      fresh.id,
      fresh.hashedCode,
    );

    expect({ staleClaim, freshClaim }).toEqual({
      staleClaim: false,
      freshClaim: true,
    });
  });
}
