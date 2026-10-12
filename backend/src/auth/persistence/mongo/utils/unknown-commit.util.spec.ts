import type { LoggerService } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import { partialMock } from '../../../../common/testing/test-doubles.harness-spec';
import { UnknownTransactionOutcomeError } from '../../../../common/exceptions/unknown-transaction-outcome.error';
import { logUnknownCommit } from '../../../utils/unknown-commit.util';

describe('unknown commit logging', () => {
  it('logs sanitized error and cause facts without the driver message', () => {
    const log = jest.fn();
    const logger = partialMock<LoggerService>({ error: log });
    const driverError = new MongoServerError({
      message: 'private@example.test commit answer lost',
      code: 91,
    });
    const error = new UnknownTransactionOutcomeError(driverError);

    logUnknownCommit(logger, 'Activation', error);

    expect(log).toHaveBeenCalledWith(
      'Activation commit result unknown: name=UnknownTransactionOutcomeError cause=name=MongoServerError code=91',
    );
    expect(String(log.mock.calls[0]?.[0])).not.toContain(
      'private@example.test',
    );
  });
});
