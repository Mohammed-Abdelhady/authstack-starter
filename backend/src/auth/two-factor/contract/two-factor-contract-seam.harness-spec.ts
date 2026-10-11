import * as bcrypt from 'bcrypt';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import {
  challengedBrowser,
  MAX_WRONG_ANSWERS,
  NO_SECOND_FACTOR,
  OWNER_EMAIL,
  PASSWORD,
  RECOVERY_HASH,
  rejectionOf,
  seedEnabled,
  twoFactorCase,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const NOW = new Date('2099-01-01T12:00:00.000Z');
const LATER = new Date('2099-01-01T12:05:00.000Z');
const NONCE_HASH = 'c'.repeat(64);

/** What crosses the seam: ids as strings, absence as null, refusals by type. */
export function seamCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  twoFactorCase(
    'hands ids out and takes them back as the same strings',
    async () => {
      const { ownerId } = fixture();
      const { accounts, challenges } = harness();
      const services = twoFactorServices(harness());
      const key = { nonceHash: NONCE_HASH, userId: ownerId };
      const challengeId = await harness().seedChallenge({
        ...key,
        expiresAt: LATER,
      });

      expect([
        (await accounts.findAccount(ownerId))?.id,
        (await accounts.findAccountWithPassword(ownerId))?.id,
        (await accounts.findChallengedAccount(ownerId))?.id,
      ]).toEqual([ownerId, ownerId, ownerId]);
      expect(await challenges.find(key)).toEqual({
        id: challengeId,
        userId: ownerId,
        attempts: 0,
        expiresAt: LATER,
      });
      const claimed = await challenges.claim(key, {
        now: NOW,
        maxAttempts: MAX_WRONG_ANSWERS,
      });
      expect(claimed).toMatchObject({ id: challengeId, userId: ownerId });
      expect(await challenges.countFailure(challengeId)).toEqual({
        attempts: 1,
      });
      await challenges.discard(challengeId);
      expect(await harness().storedChallenges()).toEqual([]);

      // And through the service, from the cookie to the stored row.
      const holder = await challengedBrowser(services, ownerId);
      const [stored] = await harness().storedChallenges();
      expect(await services.challenge.claim(holder.request)).toEqual({
        challengeId: stored.id,
        userId: ownerId,
        firstFactor: 'password',
      });
    },
  );

  twoFactorCase(
    'reads the account as stored, with its password only when asked',
    async () => {
      const { ownerId } = fixture();
      const { accounts } = harness();
      await harness().setDeleted(ownerId, true);

      const plain = await accounts.findAccount(ownerId);
      const challenged = await accounts.findChallengedAccount(ownerId);
      const withPassword = await accounts.findAccountWithPassword(ownerId);

      expect(plain).toEqual({
        id: ownerId,
        email: OWNER_EMAIL,
        isDeleted: true,
        passwordHash: undefined,
        twoFactor: NO_SECOND_FACTOR,
      });
      expect(challenged).toEqual(plain);
      expect({ ...withPassword, passwordHash: undefined }).toEqual(plain);
      expect(
        await bcrypt.compare(PASSWORD, withPassword?.passwordHash ?? ''),
      ).toBe(true);
    },
  );

  twoFactorCase(
    'reads the stored state back in the order it was written',
    async () => {
      const { ownerId } = fixture();
      const { accounts } = harness();
      const secret = { ciphertext: 'Y2lwaGVy', iv: 'aXY=', tag: 'dGFn' };
      const account = await accounts.findAccount(ownerId);
      if (!account) throw new Error('the seeded account was not found');
      const hashes = ['3', '1', '2'].map((digit) => digit.repeat(64));

      await accounts.savePendingSecret(account, secret);
      await accounts.saveConfirmation(account, {
        recoveryCodeHashes: hashes,
        confirmedAt: NOW,
      });

      const expected = {
        enabled: true,
        secret,
        confirmedAt: NOW,
        recoveryCodes: hashes.map((hash) => ({ hash, usedAt: null })),
        lastUsedStep: null,
      };
      expect((await accounts.findAccount(ownerId))?.twoFactor).toEqual(
        expected,
      );
      expect(await harness().secondFactor(ownerId)).toEqual(expected);

      await accounts.replaceRecoveryCodes(account, [RECOVERY_HASH]);
      expect((await accounts.findAccount(ownerId))?.twoFactor).toEqual({
        ...expected,
        recoveryCodes: [{ hash: RECOVERY_HASH, usedAt: null }],
      });

      await accounts.clear(account);
      expect((await accounts.findAccount(ownerId))?.twoFactor).toEqual(
        NO_SECOND_FACTOR,
      );
      expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
    },
  );

  twoFactorCase(
    'keeps nothing of the second factor once its account is removed',
    async () => {
      const { ownerId, otherId } = fixture();
      const { crypto } = twoFactorServices(harness());
      await seedEnabled(harness(), crypto, ownerId);
      await seedEnabled(harness(), crypto, otherId);

      await harness().removeAccount(ownerId);

      expect(await harness().accounts.findAccount(ownerId)).toBe(null);
      expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
      expect((await harness().secondFactor(otherId)).enabled).toBe(true);
    },
  );

  twoFactorCase(
    'answers null for an id that names nothing and says which ids are its own',
    async () => {
      const { ownerId } = fixture();
      const { accounts, challenges } = harness();
      const absent = harness().absentId();

      expect([
        await accounts.findAccount(absent),
        await accounts.findAccountWithPassword(absent),
        await accounts.findChallengedAccount(absent),
        await challenges.find({ nonceHash: NONCE_HASH, userId: absent }),
        await challenges.countFailure(absent),
      ]).toEqual([null, null, null, null, null]);
      await challenges.discard(absent);

      const candidates = [
        ownerId,
        absent,
        'not-an-id',
        '',
        harness().foreignId(),
      ];
      expect(candidates.map((id) => accounts.isAccountId(id))).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(candidates.map((id) => challenges.isAccountId(id))).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    },
  );

  twoFactorCase(
    'refuses a malformed id before anything is read or written',
    async () => {
      const { accounts, challenges } = harness();
      const limits = { now: NOW, maxAttempts: MAX_WRONG_ANSWERS };

      for (const id of ['not-an-id', '', harness().foreignId()]) {
        const key = { nonceHash: NONCE_HASH, userId: id };
        const refusals = await Promise.all([
          rejectionOf(accounts.findAccount(id)),
          rejectionOf(accounts.findAccountWithPassword(id)),
          rejectionOf(accounts.findChallengedAccount(id)),
          rejectionOf(challenges.open({ ...key, expiresAt: LATER })),
          rejectionOf(challenges.find(key)),
          rejectionOf(challenges.claim(key, limits)),
          rejectionOf(challenges.countFailure(id)),
          rejectionOf(challenges.discard(id)),
        ]);

        expect(
          refusals.map((refusal) => refusal instanceof MalformedIdError),
        ).toEqual([true, true, true, true, true, true, true, true]);
      }
      expect(await harness().storedChallenges()).toEqual([]);
    },
  );
}
