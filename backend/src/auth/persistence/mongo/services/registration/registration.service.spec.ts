import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { MongoTopologyClosedError } from 'mongodb';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { PENDING_PURPOSE } from '../../../../constants/registration';
import {
  bootMongoAccountsHarness,
  MongoAccountsHarness,
} from '../../../../../../test/utils/user/accounts-contract/mongo-accounts-harness';
import { servicesOn } from '../../../../../../test/utils/user/accounts-contract/accounts-contract-support';
import { loseCommitAnswers } from '../../../../../../test/utils/transaction-failure';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/hook-timeouts';
import { partialMock } from '../../../../../common/testing/test-doubles.harness-spec';

describe('unknown commit followed by an unreadable account', () => {
  let harness: MongoAccountsHarness;
  beforeAll(async () => {
    harness = await bootMongoAccountsHarness();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await harness?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.reset();
  }, SESSION_AUTHORITY_RESET_TIMEOUT_MS);

  // A lost commit and failed verification read must never imply success.
  it.each([PENDING_PURPOSE.SIGNUP, PENDING_PURPOSE.EMAIL_CHANGE])(
    'refuses to report success after an unreadable %s commit',
    async (purpose) => {
      const services = servicesOn(harness);
      const userId =
        purpose === PENDING_PURPOSE.EMAIL_CHANGE
          ? await harness.seedAccount({
              email: 'old@example.test',
              pendingEmail: 'person@example.test',
              addressGeneration: 4,
              role: 'user',
            })
          : undefined;
      const issued =
        await services.verification.createOrUpdatePendingRegistration(
          'person@example.test',
          purpose,
          userId === undefined ? {} : { userId, addressGeneration: 4 },
        );
      if (!issued) throw new Error('code was not issued');
      const connection = harness.booted.connection;
      const lost = loseCommitAnswers(connection, {
        lands: true,
        times: 1,
        afterLanding: async () => {
          await connection.close(true);
        },
        errorFactory: () => new MongoTopologyClosedError(),
      });
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      try {
        const result =
          purpose === PENDING_PURPOSE.SIGNUP
            ? services.registration.activate(
                {
                  email: 'person@example.test',
                  code: issued.code,
                  password: 'Password123!',
                  name: 'Person',
                },
                partialMock<Response>({}),
                'en',
              )
            : services.emailChange.confirm({
                email: 'person@example.test',
                code: issued.code,
              });
        await expect(result).rejects.toMatchObject({
          code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
          status: 503,
        });
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining('cause=name=MongoTopologyClosedError'),
        );
      } finally {
        lost.restore();
        log.mockRestore();
        // Clear Mongoose's force-closed guard before reusing this connection.
        await connection.close(false);
        await connection.openUri(harness.mongo.uri('accounts_contract'));
      }
      expect(
        await harness.accountIdByEmail('person@example.test'),
      ).not.toBeNull();
      expect(await harness.pendingRegistrations('person@example.test')).toBe(0);
    },
  );
});
