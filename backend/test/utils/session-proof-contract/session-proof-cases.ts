import { FRESH_PROOF_KIND } from '../../../src/auth/contracts/constants/fresh-proof';
import {
  OpenProofChallenge,
  ProofSessionRef,
  RecordedProof,
} from '../../../src/auth/proof/types/session-proof';
import { UniqueConflictError } from '../../../src/common/persistence/persistence-errors';
import { TEST_NOW } from '../frozen-clock';
import { SessionProofHarnessSource } from './session-proof-harness';

const EXPIRES_AT = new Date('2099-01-01T12:05:00.000Z');
const PURGE_AFTER = new Date('2099-01-02T12:00:00.000Z');
const EARLIER_PURGE = new Date('2099-01-01T13:00:00.000Z');
const RP_ID = 'staff.example.com';
const GUESS_LIMIT = 5;

function challenge(ref: ProofSessionRef): OpenProofChallenge {
  return {
    ...ref,
    kind: FRESH_PROOF_KIND.EMAIL_CODE,
    challengeHash: 'code-hash',
    expiresAt: EXPIRES_AT,
    purgeAfter: PURGE_AFTER,
  };
}

function proof(ref: ProofSessionRef): RecordedProof {
  return {
    ...ref,
    kind: FRESH_PROOF_KIND.PASSKEY,
    rpId: RP_ID,
    userVerified: true,
    provedAt: TEST_NOW,
    purgeAfter: PURGE_AFTER,
  };
}

export function sessionProofCases(current: SessionProofHarnessSource): void {
  it('prevents a proof from authorizing a different session, account or client', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    const otherSession = await harness.seedSession(ref.userId);
    const otherAccount = await harness.seedSession();
    await harness
      .runner()
      .run((uow) => harness.store.recordProof(uow, proof(ref)));
    await harness.runner().run(async (uow) => {
      expect(await harness.store.readProof(uow, otherSession)).toBeNull();
      expect(
        await harness.store.readProof(uow, {
          ...ref,
          userId: otherAccount.userId,
        }),
      ).toBeNull();
      expect(
        await harness.store.readProof(uow, {
          ...ref,
          clientId: 'other-client',
        }),
      ).toBeNull();
      expect(await harness.store.readProof(uow, ref)).toEqual({
        ...ref,
        kind: FRESH_PROOF_KIND.PASSKEY,
        rpId: RP_ID,
        userVerified: true,
        provedAt: TEST_NOW,
      });
    });
  });

  it('clears the challenge on the fifth wrong guess without granting another guess', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    await harness
      .runner()
      .run((uow) => harness.store.openChallenge(uow, challenge(ref)));
    for (let count = 1; count < GUESS_LIMIT; count += 1) {
      expect(
        await harness
          .runner()
          .run((uow) => harness.store.recordWrongGuess(uow, ref, GUESS_LIMIT)),
      ).toBe(count);
    }
    expect(
      await harness
        .runner()
        .run((uow) =>
          harness.store.takeChallenge(uow, ref, FRESH_PROOF_KIND.EMAIL_CODE),
        ),
    ).toEqual({
      kind: FRESH_PROOF_KIND.EMAIL_CODE,
      challengeHash: 'code-hash',
      expiresAt: EXPIRES_AT,
      wrongGuesses: 4,
    });
    expect(
      await harness
        .runner()
        .run((uow) => harness.store.recordWrongGuess(uow, ref, GUESS_LIMIT)),
    ).toBe(5);
    expect(
      await harness
        .runner()
        .run((uow) =>
          harness.store.takeChallenge(uow, ref, FRESH_PROOF_KIND.EMAIL_CODE),
        ),
    ).toBeNull();
    expect(
      await harness
        .runner()
        .run((uow) => harness.store.recordWrongGuess(uow, ref, GUESS_LIMIT)),
    ).toBe(0);
  });

  it('consumes the challenge when proof is recorded and retains the session identity', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    await harness
      .runner()
      .run((uow) => harness.store.openChallenge(uow, challenge(ref)));
    await harness.runner().run((uow) =>
      harness.store.recordProof(uow, {
        ...proof(ref),
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
      }),
    );
    await harness.runner().run(async (uow) => {
      expect(
        await harness.store.takeChallenge(
          uow,
          ref,
          FRESH_PROOF_KIND.EMAIL_CODE,
        ),
      ).toBeNull();
      expect(await harness.store.readProof(uow, ref)).toEqual({
        ...ref,
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
        provedAt: TEST_NOW,
      });
    });
  });

  it('does not return another challenge kind and leaves expiry decisions to the caller', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    await harness.runner().run((uow) =>
      harness.store.openChallenge(uow, {
        ...challenge(ref),
        expiresAt: new Date('2098-12-31T12:00:00.000Z'),
      }),
    );
    await harness.runner().run(async (uow) => {
      expect(
        await harness.store.takeChallenge(uow, ref, FRESH_PROOF_KIND.PASSKEY),
      ).toBeNull();
      expect(
        await harness.store.takeChallenge(
          uow,
          ref,
          FRESH_PROOF_KIND.EMAIL_CODE,
        ),
      ).toEqual({
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
        challengeHash: 'code-hash',
        expiresAt: new Date('2098-12-31T12:00:00.000Z'),
        wrongGuesses: 0,
      });
    });
  });

  it('refuses a passkey proof with no relying party', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    const withoutRpId: RecordedProof = {
      ...ref,
      kind: FRESH_PROOF_KIND.PASSKEY,
      userVerified: true,
      provedAt: TEST_NOW,
      purgeAfter: PURGE_AFTER,
    };
    await harness
      .runner()
      .run((uow) => harness.store.recordProof(uow, withoutRpId));
    expect(
      await harness.runner().run((uow) => harness.store.readProof(uow, ref)),
    ).toBeNull();
  });

  it('keeps the existing proof and retention when a challenge is replaced', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    await harness
      .runner()
      .run((uow) => harness.store.recordProof(uow, proof(ref)));
    await harness.runner().run(async (uow) => {
      await harness.store.openChallenge(uow, challenge(ref));
      await harness.store.recordWrongGuess(uow, ref, GUESS_LIMIT);
    });
    await harness.runner().run((uow) =>
      harness.store.openChallenge(uow, {
        ...challenge(ref),
        challengeHash: 'replacement-hash',
        purgeAfter: EARLIER_PURGE,
      }),
    );
    await harness.runner().run(async (uow) => {
      expect(await harness.store.readProof(uow, ref)).toMatchObject({
        ...ref,
        rpId: RP_ID,
        provedAt: TEST_NOW,
      });
      expect(
        await harness.store.takeChallenge(
          uow,
          ref,
          FRESH_PROOF_KIND.EMAIL_CODE,
        ),
      ).toEqual({
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
        challengeHash: 'replacement-hash',
        expiresAt: EXPIRES_AT,
        wrongGuesses: 0,
      });
    });
    expect(await harness.purgeAfter(ref)).toEqual(PURGE_AFTER);
  });

  it('prevents another account or client from consuming or changing the challenge', async () => {
    const harness = current();
    const ref = await harness.seedSession();
    const otherAccount = await harness.seedSession();
    await harness
      .runner()
      .run((uow) => harness.store.openChallenge(uow, challenge(ref)));
    for (const otherRef of [
      { ...ref, clientId: 'other-client' },
      { ...ref, userId: otherAccount.userId },
    ]) {
      await harness.runner().run(async (uow) => {
        expect(
          await harness.store.takeChallenge(
            uow,
            otherRef,
            FRESH_PROOF_KIND.EMAIL_CODE,
          ),
        ).toBeNull();
        expect(
          await harness.store.recordWrongGuess(uow, otherRef, GUESS_LIMIT),
        ).toBe(0);
      });
      for (const write of [
        () =>
          harness
            .runner()
            .run((uow) => harness.store.recordProof(uow, proof(otherRef))),
        () =>
          harness.runner().run((uow) =>
            harness.store.openChallenge(uow, {
              ...challenge(otherRef),
              challengeHash: 'another-account-hash',
            }),
          ),
      ]) {
        try {
          await write();
        } catch (error) {
          if (!(error instanceof UniqueConflictError)) throw error;
        }
      }
    }
    expect(
      await harness.runner().run((uow) => harness.store.readProof(uow, ref)),
    ).toBeNull();
    expect(
      await harness
        .runner()
        .run((uow) =>
          harness.store.takeChallenge(uow, ref, FRESH_PROOF_KIND.EMAIL_CODE),
        ),
    ).toEqual({
      kind: FRESH_PROOF_KIND.EMAIL_CODE,
      challengeHash: 'code-hash',
      expiresAt: EXPIRES_AT,
      wrongGuesses: 0,
    });
  });
}
