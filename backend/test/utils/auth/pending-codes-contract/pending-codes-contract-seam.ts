import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../../src/common/persistence/persistence-errors';
import { TEST_NOW } from '../../frozen-clock';
import {
  contractServices,
  HarnessSource,
  LIVE_EXPIRY,
  rejectionOf,
  rerunAtOnce,
} from './pending-codes-contract-support';

const SIGNUP = PENDING_PURPOSE.SIGNUP;
const MALFORMED_IDS = { word: 'not-an-id', empty: '' } as const;

function conflictOf(failure: unknown): string | null {
  return failure instanceof UniqueConflictError ? failure.constraint : null;
}

/** Code identifiers, addresses and shared errors. */
export function pendingCodeSeamCases(harness: HarnessSource): void {
  it('refuses a second record for one address and purpose as a unique conflict', async () => {
    const store = harness().stores.registrations;
    const key = { email: 'twice@example.test', purpose: SIGNUP };
    const generation = { hashedCode: 'first', expiresAt: LIVE_EXPIRY };
    await store.insertRecord(key, generation);

    const failure = await rejectionOf(
      store.insertRecord(key, { ...generation, hashedCode: 'second' }),
    );
    const cleared = await store.clearLegacyBlocker(key.email);

    expect({
      constraint: conflictOf(failure),
      cleared,
      rows: await harness().registrationCount(),
      stored: (await harness().registration(key.email, SIGNUP))?.hashedCode,
    }).toEqual({
      constraint: 'pending_registration.email_purpose',
      cleared: 'cleared',
      rows: 1,
      stored: 'first',
    });
  });

  it('refuses a second password reset record for one address as a unique conflict', async () => {
    const store = harness().stores.passwordResets;
    const generation = { hashedCode: 'first', expiresAt: LIVE_EXPIRY };
    await store.insertRecord('twice@example.test', generation);

    const failure = await rejectionOf(
      store.insertRecord('twice@example.test', generation),
    );

    expect({
      constraint: conflictOf(failure),
      rows: await harness().passwordResetCount(),
    }).toEqual({ constraint: 'pending_password_reset.email', rows: 1 });
  });

  it('stores an address trimmed and in lower case and finds it by either form', async () => {
    const services = await contractServices(harness());
    const typed = '  Mixed.Case@Example.Test ';
    const storedForm = 'mixed.case@example.test';
    try {
      const issued =
        await services.verification.createOrUpdatePendingRegistration(
          typed,
          SIGNUP,
        );
      const reserved = await services.verification.verifyCode(
        typed,
        issued?.code ?? '',
        SIGNUP,
      );
      const resetCode =
        await services.passwordReset.createOrUpdatePasswordReset(typed);
      const reset = await services.passwordReset.verifyPasswordReset(
        storedForm,
        resetCode,
      );

      expect({
        registration: (await harness().registration(storedForm, SIGNUP))?.email,
        reservedEmail: reserved.email,
        counter: (await harness().counter(storedForm, SIGNUP))?.mailedCodes,
        reset: (await harness().passwordReset(storedForm))?.id === reset.id,
        rows: [
          await harness().registrationCount(),
          await harness().counterCount(),
          await harness().passwordResetCount(),
        ],
      }).toEqual({
        registration: storedForm,
        reservedEmail: storedForm,
        counter: 1,
        reset: true,
        rows: [1, 1, 1],
      });
    } finally {
      services.restore();
    }
  });

  it.each([
    ['a word', 'word'],
    ['an empty string', 'empty'],
    ["another database's id", 'foreign'],
  ] as const)(
    'refuses %s as malformed in every method that takes an id',
    async (_, kind) => {
      const id =
        kind === 'foreign' ? harness().foreignId() : MALFORMED_IDS[kind];
      const { registrations, passwordResets } = harness().stores;
      const key = { email: 'ids@example.test', purpose: SIGNUP };
      const bound = { hashedCode: 'hash', expiresAt: LIVE_EXPIRY, userId: id };
      await harness().seedRegistration({
        ...key,
        hashedCode: 'hash',
        attempts: 0,
        expiresAt: LIVE_EXPIRY,
      });
      const attempts: Array<() => Promise<unknown>> = [
        () =>
          harness()
            .runner(rerunAtOnce)
            .run((unitOfWork) =>
              registrations.claimCode(unitOfWork, {
                id,
                purpose: SIGNUP,
                hashedCode: 'hash',
                now: TEST_NOW,
              }),
            ),
        () =>
          passwordResets.claimCode({ id, hashedCode: 'hash', now: TEST_NOW }),
        () => registrations.rotateLiveCode(key, TEST_NOW, bound),
        () => registrations.replaceExpiredCode(key, TEST_NOW, bound),
        () =>
          registrations.insertRecord(
            { email: 'other@example.test', purpose: SIGNUP },
            bound,
          ),
      ];

      const refusals: boolean[] = [];
      for (const attempt of attempts) {
        refusals.push(
          (await rejectionOf(attempt())) instanceof MalformedIdError,
        );
      }

      expect({
        refusals,
        stored: (await harness().registration(key.email, SIGNUP))?.hashedCode,
        rows: await harness().registrationCount(),
      }).toEqual({
        refusals: [true, true, true, true, true],
        stored: 'hash',
        rows: 1,
      });
    },
  );

  it('answers a well-formed id that names no record as not claimable', async () => {
    const id = harness().accountId();

    const registration = await harness()
      .runner(rerunAtOnce)
      .run((unitOfWork) =>
        harness().stores.registrations.claimCode(unitOfWork, {
          id,
          purpose: SIGNUP,
          hashedCode: 'hash',
          now: TEST_NOW,
        }),
      );
    const reset = await harness().stores.passwordResets.claimCode({
      id,
      hashedCode: 'hash',
      now: TEST_NOW,
    });

    expect({ registration, reset }).toEqual({
      registration: 'not_claimable',
      reset: 'not_claimable',
    });
  });
}
