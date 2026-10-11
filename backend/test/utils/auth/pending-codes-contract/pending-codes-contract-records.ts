import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  contractServices,
  ContractServices,
  HarnessSource,
  matches,
} from './pending-codes-contract-support';

const EMAIL = 'signup@example.test';
const SIGNUP = PENDING_PURPOSE.SIGNUP;

/** What a code record is bound to, and two requests storing one at once. */
export function registrationRecordCases(harness: HarnessSource): void {
  let services: ContractServices;

  beforeEach(async () => {
    services = await contractServices(harness());
  });

  afterEach(() => {
    services.restore();
  });

  const open = () =>
    services.verification.createOrUpdatePendingRegistration(EMAIL, SIGNUP);
  const stored = async () => {
    const record = await harness().registration(EMAIL, SIGNUP);
    if (!record) throw new Error('expected a stored record');
    return record;
  };

  it('binds an email-change record to its account and re-points it on a refresh', async () => {
    const first = harness().accountId();
    const second = harness().accountId();
    const change = PENDING_PURPOSE.EMAIL_CHANGE;

    await services.verification.createOrUpdatePendingRegistration(
      EMAIL,
      change,
      { userId: first, addressGeneration: 3 },
    );
    const created = await harness().registration(EMAIL, change);
    await services.verification.createOrUpdatePendingRegistration(
      EMAIL,
      change,
      { userId: second },
    );
    const refreshed = await harness().registration(EMAIL, change);

    expect({
      distinct: first !== second,
      created: [created?.userId, created?.addressGeneration],
      refreshed: [refreshed?.userId, refreshed?.addressGeneration],
      sameRow: created?.id === refreshed?.id,
    }).toEqual({
      distinct: true,
      created: [first, 3],
      refreshed: [second, 0],
      sameRow: true,
    });
  });

  it('keeps one sign-up record and one email-change record for one address', async () => {
    await open();
    await services.verification.createOrUpdatePendingRegistration(
      EMAIL,
      PENDING_PURPOSE.EMAIL_CHANGE,
      { userId: harness().accountId(), addressGeneration: 1 },
    );
    await open();

    expect(await harness().registrationCount()).toBe(2);
  });

  it('refreshes the record that won when two requests store one at once', async () => {
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const restore = holdBefore(
      harness().stores.registrations,
      'insertRecord',
      (call) => [firstGate, secondGate][call],
    );
    let codes: Array<string | undefined>;
    try {
      const first = open();
      await firstGate.reached(1);
      const second = open();
      await secondGate.reached(1);

      firstGate.release();
      const firstIssued = await first;
      secondGate.release();
      const secondIssued = await second;
      codes = [firstIssued?.code, secondIssued?.code];
    } finally {
      restore();
    }
    const record = await stored();

    expect({
      issued: codes.map((code) => typeof code),
      rows: await harness().registrationCount(),
      firstIsStored: await matches(codes[0] ?? '', record.hashedCode),
      secondIsStored: await matches(codes[1] ?? '', record.hashedCode),
    }).toEqual({
      issued: ['string', 'string'],
      rows: 1,
      firstIsStored: codes[0] === codes[1],
      secondIsStored: true,
    });
  });
}
