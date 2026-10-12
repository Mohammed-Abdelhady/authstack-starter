import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import {
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import { NativeAttemptStore } from '../stores/native-attempt.store';
import {
  NativeAttempt,
  NativeAttemptGuard,
  NewNativeAttempt,
} from '../types/native-attempt';

interface AttemptHarness {
  store: NativeAttemptStore;
  clock: FrozenClock;
  unitOfWork: UnitOfWorkRunner;
  reset: () => Promise<void>;
  close: () => Promise<void>;
  checkSetup: () => Promise<void>;
}

const SECRET_HASH = 'a'.repeat(64);
const EXPIRES_AT = new Date(TEST_NOW.getTime() + 60_000);
let sequence = 0;

function input(): NewNativeAttempt {
  sequence += 1;
  return {
    attemptId: `opaque-${sequence}`,
    secretHash: SECRET_HASH,
    clientId: 'client-a',
    redirectUri: 'app://registered/callback',
    codeChallenge: 'challenge',
    state: 'state',
    requestedScopes: ['openid', 'email'],
    flow: NATIVE_ATTEMPT_FLOW.SIGN_IN,
    phase: NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    authEpoch: 3,
    createdAt: TEST_NOW,
    expiresAt: EXPIRES_AT,
    details: {
      verifiedAccount: {
        userId: 'user-1',
        userVersion: 2,
        clientVersion: 4,
        grantVersion: null,
        authenticationMethods: ['password'],
        verifiedAt: TEST_NOW,
      },
      nonceDigest: 'b'.repeat(64),
      email: {
        address: 'test@example.com',
        generation: 5,
        requestedAt: TEST_NOW,
      },
      codeReply: {
        ciphertext: 'opaque-ciphertext',
        iv: 'iv',
        tag: 'tag',
        expiresAt: EXPIRES_AT,
      },
    },
  };
}

function guard(attempt: NativeAttempt): NativeAttemptGuard {
  return {
    attemptId: attempt.attemptId,
    clientId: attempt.clientId,
    secretHash: attempt.secretHash,
    revision: attempt.revision,
  };
}

export function describeNativeAttemptContract(
  name: string,
  boot: () => Promise<AttemptHarness>,
): void {
  describe(`${name} native attempt store`, () => {
    let harness: AttemptHarness;

    beforeAll(async () => {
      harness = await boot();
    }, 120_000);
    afterAll(async () => {
      await harness?.close();
    }, 120_000);
    beforeEach(async () => {
      harness.clock.set(TEST_NOW);
      await harness.reset();
    }, 120_000);

    it('has the public ID uniqueness and expiry setup', async () => {
      await harness.checkSetup();
    });

    it('round trips safe fields and checks exact credentials', async () => {
      const unsafe = Object.assign(input(), { password: 'must-not-persist' });
      Object.assign(unsafe.details, { verificationCode: 'must-not-persist' });
      const created = await harness.store.create(unsafe);
      expect(created).not.toHaveProperty('password');
      expect(created.details).not.toHaveProperty('verificationCode');
      expect(created.id).toBeTruthy();
      expect(created.revision).toBe(0);
      expect(
        await harness.store.findByCredentials({
          attemptId: created.attemptId,
          clientId: created.clientId,
          secretHash: created.secretHash,
        }),
      ).toEqual(created);
      expect(
        await harness.store.findByCredentials({
          attemptId: 'missing',
          clientId: created.clientId,
          secretHash: created.secretHash,
        }),
      ).toBeNull();
      expect(
        await harness.store.findByCredentials({
          attemptId: created.attemptId,
          clientId: 'other',
          secretHash: created.secretHash,
        }),
      ).toBeNull();
      expect(
        await harness.store.findByCredentials({
          attemptId: created.attemptId,
          clientId: created.clientId,
          secretHash: 'b'.repeat(64),
        }),
      ).toBeNull();
      await expect(
        harness.store.create({ ...input(), attemptId: created.attemptId }),
      ).rejects.toThrow();
      await expect(
        harness.store.create({ ...input(), secretHash: 'invalid' }),
      ).rejects.toThrow();
    });

    it('uses strict expiry at the boundary for reads and writes', async () => {
      const created = await harness.store.create(input());
      harness.clock.set(new Date(EXPIRES_AT.getTime() - 1));
      expect(await harness.store.findByCredentials(created)).not.toBeNull();
      harness.clock.set(EXPIRES_AT);
      expect(await harness.store.findByCredentials(created)).toBeNull();
      expect(await harness.store.claim(guard(created), 'operation')).toBeNull();
      expect(await harness.store.cancel(guard(created))).toBe(false);
    });

    it('refuses wrong secret and revision guards', async () => {
      const created = await harness.store.create(input());
      expect(
        await harness.store.claim(
          { ...guard(created), secretHash: 'b'.repeat(64) },
          'wrong-secret',
        ),
      ).toBeNull();
      expect(
        await harness.store.claim(
          { ...guard(created), revision: 9 },
          'wrong-revision',
        ),
      ).toBeNull();
    });

    it('allows one concurrent claim and refuses a wrong operation on release', async () => {
      const created = await harness.store.create(input());
      const claims = await Promise.all([
        harness.store.claim(guard(created), 'one'),
        harness.store.claim(guard(created), 'two'),
      ]);
      const winners = claims.filter((value) => value !== null);
      expect(winners).toHaveLength(1);
      const claimed = winners[0];
      if (!claimed) throw new Error('No claim winner');
      expect(await harness.store.claim(guard(created), 'three')).toBeNull();
      expect(
        await harness.store.release({
          ...guard(claimed),
          operationId: 'wrong',
        }),
      ).toBe(false);
      expect(
        await harness.store.release({
          ...guard(claimed),
          operationId: claimed.activeOperationId ?? '',
        }),
      ).toBe(true);
      expect(
        await harness.store.release({
          ...guard(claimed),
          operationId: claimed.activeOperationId ?? '',
        }),
      ).toBe(false);
    });

    it('refuses expiry extension while allowing equal and shorter deadlines', async () => {
      const created = await harness.store.create(input());
      const claimed = await harness.store.claim(guard(created), 'first');
      if (!claimed) throw new Error('Claim failed');
      const operation = { ...guard(claimed), operationId: 'first' };
      const next = {
        phase: NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
        details: created.details,
      };
      const later = new Date(EXPIRES_AT.getTime() + 1);
      expect(
        await harness.store.transition(operation, {
          ...next,
          expiresAt: later,
        }),
      ).toBeNull();
      const equal = await harness.store.transition(operation, {
        ...next,
        expiresAt: EXPIRES_AT,
      });
      expect(equal?.expiresAt).toEqual(EXPIRES_AT);
      const claimedAgain = await harness.store.claim(
        guard(equal ?? created),
        'second',
      );
      const earlier = new Date(EXPIRES_AT.getTime() - 1);
      const shortened = await harness.store.transition(
        { ...guard(claimedAgain ?? created), operationId: 'second' },
        { ...next, expiresAt: earlier },
      );
      expect(shortened?.expiresAt).toEqual(earlier);
    });
    it('allows one transition and rejects late writes after cancellation', async () => {
      const created = await harness.store.create(input());
      const claimed = await harness.store.claim(guard(created), 'remote');
      if (!claimed) throw new Error('Claim failed');
      const next = {
        phase: NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
        expiresAt: EXPIRES_AT,
        details: created.details,
      };
      expect(
        await harness.store.transition(
          { ...guard(claimed), operationId: 'wrong' },
          next,
        ),
      ).toBeNull();
      const operations = await Promise.all([
        harness.store.transition(
          { ...guard(claimed), operationId: 'remote' },
          next,
        ),
        harness.store.transition(
          { ...guard(claimed), operationId: 'remote' },
          next,
        ),
      ]);
      expect(operations.filter((value) => value !== null)).toHaveLength(1);
      const advanced = operations.find((value) => value !== null);
      if (!advanced) throw new Error('No transition winner');
      const claimedAgain = await harness.store.claim(guard(advanced), 'slow');
      if (!claimedAgain) throw new Error('Second claim failed');
      expect(await harness.store.cancel(guard(claimedAgain))).toBe(true);
      expect(
        await harness.store.transition(
          { ...guard(claimedAgain), operationId: 'slow' },
          next,
        ),
      ).toBeNull();
      expect(
        await harness.store.release({
          ...guard(claimedAgain),
          operationId: 'slow',
        }),
      ).toBe(false);
      expect(await harness.store.cancel(guard(claimedAgain))).toBe(false);
      expect(await harness.store.findByCredentials(created)).toBeNull();
    });

    it('keeps a completed code reply readable but terminal for mutation', async () => {
      const created = await harness.store.create(input());
      const claimed = await harness.store.claim(guard(created), 'approve');
      if (!claimed) throw new Error('Claim failed');
      const ready = await harness.store.transition(
        { ...guard(claimed), operationId: 'approve' },
        {
          phase: NATIVE_ATTEMPT_PHASE.CODE_READY,
          expiresAt: EXPIRES_AT,
          details: created.details,
        },
      );
      expect(ready?.phase).toBe(NATIVE_ATTEMPT_PHASE.CODE_READY);
      expect(
        (await harness.store.findByCredentials(created))?.details.codeReply,
      ).toEqual(created.details.codeReply);
      if (!ready) throw new Error('Transition failed');
      expect(await harness.store.claim(guard(ready), 'replay')).toBeNull();
      expect(await harness.store.cancel(guard(ready))).toBe(false);
    });

    it('commits a claim and transition in one unit of work', async () => {
      const created = await harness.store.create(input());
      await harness.unitOfWork.run(async (work) => {
        const claimed = await harness.store.claimIn(
          work,
          guard(created),
          'atomic',
        );
        if (!claimed) throw new Error('Claim failed');
        const changed = await harness.store.transitionIn(
          work,
          { ...guard(claimed), operationId: 'atomic' },
          {
            phase: NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
            expiresAt: EXPIRES_AT,
            details: created.details,
          },
        );
        expect(changed?.revision).toBe(2);
      });
      expect((await harness.store.findByCredentials(created))?.phase).toBe(
        NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
      );
    });

    it('lets a unit of work roll back a claim and transition', async () => {
      const created = await harness.store.create(input());
      await expect(
        harness.unitOfWork.run(async (work) => {
          const claimed = await harness.store.claimIn(
            work,
            guard(created),
            'transaction',
          );
          if (!claimed) throw new Error('Claim failed');
          const next = await harness.store.transitionIn(
            work,
            { ...guard(claimed), operationId: 'transaction' },
            {
              phase: NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
              expiresAt: EXPIRES_AT,
              details: created.details,
            },
          );
          expect(next?.phase).toBe(NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED);
          throw new Error('abort fixture');
        }),
      ).rejects.toThrow('abort fixture');
      expect(await harness.store.findByCredentials(created)).toEqual(created);
    });
  });
}
