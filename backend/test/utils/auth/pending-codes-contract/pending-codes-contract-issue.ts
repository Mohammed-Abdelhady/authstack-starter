import {
  MAIL_COUNTER_PURPOSE,
  PENDING_PURPOSE,
} from '../../../../src/auth/constants/registration';
import { TEST_NOW } from '../../frozen-clock';
import {
  CODE,
  contractServices,
  ContractServices,
  EXPIRED_EXPIRY,
  hashOf,
  HarnessSource,
  LIVE_EXPIRY,
  MAIL_CAP,
  matches,
} from './pending-codes-contract-support';

const EMAIL = 'signup@example.test';
const SIGNUP = PENDING_PURPOSE.SIGNUP;
const NEW_EXPIRY = new Date('2099-01-01T12:15:00.000Z');
const UNDER_CAP_MAIL = [
  'mail.recordWithinCap',
  'mail.hasCounter',
  'mail.openCounter',
];

/** Opening, refreshing, replacing and resending a sign-up code. */
export function registrationIssueCases(harness: HarnessSource): void {
  let services: ContractServices;

  beforeEach(async () => {
    services = await contractServices(harness());
  });

  afterEach(() => {
    services.restore();
  });

  const open = () =>
    services.verification.createOrUpdatePendingRegistration(EMAIL, SIGNUP);
  const resend = () =>
    services.verification.resendActivationCode(EMAIL, SIGNUP);
  const seed = async (expiresAt: Date, attempts = 0): Promise<string> =>
    harness().seedRegistration({
      email: EMAIL,
      purpose: SIGNUP,
      hashedCode: await hashOf(CODE),
      attempts,
      expiresAt,
    });
  const capTheAddress = () =>
    harness().seedCounter({
      email: EMAIL,
      purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
      mailedCodes: MAIL_CAP,
      windowStartedAt: TEST_NOW,
      expiresAt: NEW_EXPIRY,
    });
  const stored = async () => {
    const record = await harness().registration(EMAIL, SIGNUP);
    if (!record) throw new Error('expected a stored record');
    return record;
  };

  it('stores a record for an address that has none, with one hash', async () => {
    const issued = await open();
    const record = await stored();

    expect({
      codeShape: /^\d{6}$/.test(issued?.code ?? ''),
      codeIsStored: await matches(issued?.code ?? '', record.hashedCode),
      attempts: record.attempts,
      expiresAt: record.expiresAt,
      purpose: record.purpose,
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      codeShape: true,
      codeIsStored: true,
      attempts: 0,
      expiresAt: NEW_EXPIRY,
      purpose: 'signup',
      calls: [
        ...UNDER_CAP_MAIL,
        'registration.rotateLiveCode',
        'registration.replaceExpiredCode',
        'registration.hasRecord',
        'registration.insertRecord',
      ],
      work: { hashes: 1, comparisons: 0 },
    });
  });

  it('gives a live record a new code and zero attempts, and the old code stops matching', async () => {
    const id = await seed(new Date(TEST_NOW.getTime() + 1), 3);

    const issued = await open();
    const record = await stored();

    expect({
      sameRow: record.id === id,
      newCodeIsStored: await matches(issued?.code ?? '', record.hashedCode),
      oldCodeIsStored: await matches(CODE, record.hashedCode),
      attempts: record.attempts,
      expiresAt: record.expiresAt,
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      sameRow: true,
      newCodeIsStored: true,
      oldCodeIsStored: false,
      attempts: 0,
      expiresAt: NEW_EXPIRY,
      calls: [...UNDER_CAP_MAIL, 'registration.rotateLiveCode'],
      work: { hashes: 1, comparisons: 0 },
    });
  });

  it('replaces a record that expired at this instant and is still stored', async () => {
    await seed(TEST_NOW, 5);

    const issued = await open();
    const record = await stored();

    expect({
      newCodeIsStored: await matches(issued?.code ?? '', record.hashedCode),
      attempts: record.attempts,
      expiresAt: record.expiresAt,
      rows: await harness().registrationCount(),
      calls: services.storeCalls,
    }).toEqual({
      newCodeIsStored: true,
      attempts: 0,
      expiresAt: NEW_EXPIRY,
      rows: 1,
      calls: [
        ...UNDER_CAP_MAIL,
        'registration.rotateLiveCode',
        'registration.replaceExpiredCode',
      ],
    });
  });

  it('resends nothing for an expired record, drops it and still hashes once', async () => {
    await seed(EXPIRED_EXPIRY);

    const issued = await resend();

    expect({
      issued,
      rows: await harness().registrationCount(),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      issued: null,
      rows: 0,
      calls: [
        ...UNDER_CAP_MAIL,
        'registration.rotateLiveCode',
        'registration.hasRecord',
        'registration.dropExpiredRecord',
      ],
      work: { hashes: 1, comparisons: 0 },
    });
  });

  it('resends nothing for an address with no record and still hashes once', async () => {
    const issued = await resend();

    expect({
      issued,
      rows: await harness().registrationCount(),
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      issued: null,
      rows: 0,
      calls: [
        ...UNDER_CAP_MAIL,
        'registration.rotateLiveCode',
        'registration.hasRecord',
      ],
      work: { hashes: 1, comparisons: 0 },
    });
  });

  it('resends a new code for a live record with one hash', async () => {
    await seed(LIVE_EXPIRY, 2);

    const issued = await resend();
    const record = await stored();

    expect({
      newCodeIsStored: await matches(issued?.code ?? '', record.hashedCode),
      attempts: record.attempts,
      calls: services.storeCalls,
      work: services.hashWork(),
    }).toEqual({
      newCodeIsStored: true,
      attempts: 0,
      calls: [...UNDER_CAP_MAIL, 'registration.rotateLiveCode'],
      work: { hashes: 1, comparisons: 0 },
    });
  });

  it.each([
    ['a new record', open],
    ['a resend', resend],
  ] as const)(
    'refuses %s over the mail cap: nothing issued, nothing stored, one hash',
    async (_, request) => {
      await capTheAddress();

      const issued = await request();

      expect({
        issued,
        rows: await harness().registrationCount(),
        counted: (await harness().counter(EMAIL, MAIL_COUNTER_PURPOSE.SIGNUP))
          ?.mailedCodes,
        calls: services.storeCalls,
        work: services.hashWork(),
      }).toEqual({
        issued: null,
        rows: 0,
        counted: 5,
        calls: ['mail.recordWithinCap', 'mail.hasCounter'],
        work: { hashes: 1, comparisons: 0 },
      });
    },
  );

  it('leaves a live record as it was when the address is over the mail cap', async () => {
    await capTheAddress();
    await seed(LIVE_EXPIRY, 2);

    const issued = await open();
    const record = await stored();

    expect({
      issued,
      oldCodeIsStored: await matches(CODE, record.hashedCode),
      attempts: record.attempts,
    }).toEqual({ issued: null, oldCodeIsStored: true, attempts: 2 });
  });
}
