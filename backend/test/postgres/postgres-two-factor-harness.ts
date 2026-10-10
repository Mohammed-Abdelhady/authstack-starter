import { randomUUID } from 'node:crypto';
import { TwoFactorContractHarness } from '../../src/auth/two-factor/contract/two-factor-contract.harness-spec';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { PostgresAccountProfileStore } from '../../src/user/persistence/postgres/postgres-account-profile.store';
import { PostgresSecondFactorChallengeStore } from '../../src/auth/two-factor/persistence/postgres/postgres-second-factor-challenge.store';
import { PostgresSecondFactorStore } from '../../src/auth/two-factor/persistence/postgres/postgres-second-factor.store';
import { openTestConnection } from './postgres-connection';

const AN_OBJECT_ID = '65f000000000000000000001';

export async function bootPostgresTwoFactorHarness(): Promise<TwoFactorContractHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  const clock = new FrozenClock(TEST_NOW);
  const profiles = new PostgresAccountProfileStore(database, clock);

  return {
    clock,
    accounts: new PostgresSecondFactorStore(database),
    challenges: new PostgresSecondFactorChallengeStore(database),

    profileSaysEnabled: async (userId) =>
      (await profiles.findProfile(userId))?.twoFactorEnabled === true,

    seedAccount: async (account) => {
      const row = await database
        .insertInto('users')
        .values({
          email: account.email,
          name: 'Contract Tester',
          password_hash: account.passwordHash ?? null,
          is_verified: true,
          is_deleted: account.deleted ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    setDeleted: async (userId, deleted) => {
      await database
        .updateTable('users')
        .set({ is_deleted: deleted })
        .where('id', '=', userId)
        .execute();
    },
    removeAccount: async (userId) => {
      await database.deleteFrom('users').where('id', '=', userId).execute();
    },
    seedSecondFactor: async (userId, state) => {
      await database
        .deleteFrom('user_recovery_codes')
        .where('user_id', '=', userId)
        .execute();
      await database
        .deleteFrom('user_two_factor')
        .where('user_id', '=', userId)
        .execute();
      await database
        .insertInto('user_two_factor')
        .values({
          user_id: userId,
          enabled: state.enabled,
          secret_ciphertext: state.secret?.ciphertext ?? null,
          secret_iv: state.secret?.iv ?? null,
          secret_tag: state.secret?.tag ?? null,
          confirmed_at: state.confirmedAt,
          last_used_step: state.lastUsedStep,
        })
        .execute();
      if (state.recoveryCodes.length > 0) {
        await database
          .insertInto('user_recovery_codes')
          .values(
            state.recoveryCodes.map((code) => ({
              user_id: userId,
              hash: code.hash,
              used_at: code.usedAt,
            })),
          )
          .execute();
      }
    },
    secondFactor: async (userId) => {
      const state = await database
        .selectFrom('user_two_factor')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirst();
      const codes = await database
        .selectFrom('user_recovery_codes')
        .select(['hash', 'used_at'])
        .where('user_id', '=', userId)
        .orderBy('id')
        .execute();
      return {
        enabled: state?.enabled === true,
        secret:
          state?.secret_ciphertext && state.secret_iv && state.secret_tag
            ? {
                ciphertext: state.secret_ciphertext,
                iv: state.secret_iv,
                tag: state.secret_tag,
              }
            : null,
        confirmedAt: state?.confirmed_at ?? null,
        recoveryCodes: codes.map((code) => ({
          hash: code.hash,
          usedAt: code.used_at,
        })),
        lastUsedStep: state?.last_used_step ?? null,
      };
    },

    seedChallenge: async (challenge) => {
      const row = await database
        .insertInto('two_factor_challenges')
        .values({
          user_id: challenge.userId,
          nonce_hash: challenge.nonceHash,
          attempts: challenge.attempts ?? 0,
          claimed_at: challenge.claimedAt ?? null,
          expires_at: challenge.expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    alterChallenge: async (challengeId, change) => {
      await database
        .updateTable('two_factor_challenges')
        .set({
          ...(change.expiresAt === undefined
            ? {}
            : { expires_at: change.expiresAt }),
          ...(change.attempts === undefined
            ? {}
            : { attempts: change.attempts }),
        })
        .where('id', '=', challengeId)
        .execute();
    },
    storedChallenges: async () => {
      const rows = await database
        .selectFrom('two_factor_challenges')
        .selectAll()
        .orderBy('nonce_hash')
        .execute();
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        nonceHash: row.nonce_hash,
        attempts: row.attempts,
        claimed: row.claimed_at !== null,
        expiresAt: row.expires_at,
      }));
    },

    absentId: () => randomUUID(),
    foreignId: () => AN_OBJECT_ID,

    reset: connection.reset,
    close: connection.close,
  };
}
