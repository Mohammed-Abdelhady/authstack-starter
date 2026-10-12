import { createConnection } from 'mongoose';
import { MongoClient, MongoServerError } from 'mongodb';
import {
  UnknownTransactionOutcomeError,
  withMajorityTransaction,
} from './mongo-transaction';

class LabeledTransactionError extends Error {
  constructor(
    message: string,
    readonly errorLabels: string[],
  ) {
    super(message);
  }
}

describe('withMajorityTransaction', () => {
  it('retries an unknown commit result without rerunning the work', async () => {
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const connection = createConnection();
    let inTransaction = false;
    let workCalls = 0;
    let commitCalls = 0;
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'startTransaction').mockImplementation(() => {
      inTransaction = true;
    });
    jest
      .spyOn(session, 'inTransaction')
      .mockImplementation(() => inTransaction);
    jest.spyOn(session, 'commitTransaction').mockImplementation(() => {
      commitCalls += 1;
      if (commitCalls === 1) {
        return Promise.reject(unknownCommitError());
      }
      inTransaction = false;
      return Promise.resolve();
    });

    try {
      const result = await withMajorityTransaction(connection, () => {
        workCalls += 1;
        return Promise.resolve('committed');
      });

      expect({ result, workCalls, commitCalls }).toEqual({
        result: 'committed',
        workCalls: 1,
        commitCalls: 2,
      });
    } finally {
      await connection.close();
      await client.close();
    }
  });

  it('bounds unknown commit retries without aborting an ambiguous result', async () => {
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const connection = createConnection();
    let inTransaction = false;
    let workCalls = 0;
    let commitCalls = 0;
    let abortCalls = 0;
    const failure = unknownCommitError();
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'startTransaction').mockImplementation(() => {
      inTransaction = true;
    });
    jest
      .spyOn(session, 'inTransaction')
      .mockImplementation(() => inTransaction);
    jest.spyOn(session, 'commitTransaction').mockImplementation(() => {
      commitCalls += 1;
      return Promise.reject(failure);
    });
    jest.spyOn(session, 'endSession').mockResolvedValue(undefined);
    jest.spyOn(session, 'abortTransaction').mockImplementation(() => {
      abortCalls += 1;
      inTransaction = false;
      return Promise.resolve();
    });

    try {
      const outcome = await withMajorityTransaction(connection, () => {
        workCalls += 1;
        return Promise.resolve('committed');
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );

      expect({ outcome, workCalls, commitCalls, abortCalls }).toEqual({
        outcome: {
          error: expect.objectContaining({
            name: 'UnknownTransactionOutcomeError',
            driverError: failure,
          }),
        },
        workCalls: 1,
        commitCalls: 3,
        abortCalls: 0,
      });
    } finally {
      await connection.close();
      await client.close();
    }
  });

  it('keeps a later commit failure ambiguous after an unknown commit reply', async () => {
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const connection = createConnection();
    let inTransaction = false;
    let commitCalls = 0;
    let abortCalls = 0;
    const laterFailure = new MongoServerError({
      message: 'commit retry lost connection',
    });
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'startTransaction').mockImplementation(() => {
      inTransaction = true;
    });
    jest
      .spyOn(session, 'inTransaction')
      .mockImplementation(() => inTransaction);
    jest.spyOn(session, 'commitTransaction').mockImplementation(() => {
      commitCalls += 1;
      return Promise.reject(
        commitCalls === 1 ? unknownCommitError() : laterFailure,
      );
    });
    jest.spyOn(session, 'endSession').mockResolvedValue(undefined);
    jest.spyOn(session, 'abortTransaction').mockImplementation(() => {
      abortCalls += 1;
      return Promise.resolve();
    });

    try {
      const outcome = await withMajorityTransaction(connection, () =>
        Promise.resolve('committed'),
      ).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );

      const failure = 'error' in outcome ? outcome.error : undefined;
      expect(failure).toBeInstanceOf(UnknownTransactionOutcomeError);
      expect(failure).toMatchObject({ driverError: laterFailure });
      expect({ commitCalls, abortCalls }).toEqual({
        commitCalls: 2,
        abortCalls: 0,
      });
    } finally {
      await connection.close();
      await client.close();
    }
  });

  it('retries the whole transaction after a transient transaction error', async () => {
    jest.useFakeTimers();
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const connection = createConnection();
    let inTransaction = false;
    let workCalls = 0;
    let startCalls = 0;
    let abortCalls = 0;
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'startTransaction').mockImplementation(() => {
      startCalls += 1;
      inTransaction = true;
    });
    jest
      .spyOn(session, 'inTransaction')
      .mockImplementation(() => inTransaction);
    jest.spyOn(session, 'abortTransaction').mockImplementation(() => {
      abortCalls += 1;
      inTransaction = false;
      return Promise.resolve();
    });
    jest.spyOn(session, 'commitTransaction').mockImplementation(() => {
      inTransaction = false;
      return Promise.resolve();
    });

    try {
      const transaction = withMajorityTransaction(connection, () => {
        workCalls += 1;
        if (workCalls === 1) {
          return Promise.reject(
            new LabeledTransactionError('write conflict', [
              'TransientTransactionError',
            ]),
          );
        }
        return Promise.resolve('committed');
      });
      const outcome = transaction.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await jest.runAllTimersAsync();
      const settled = await outcome;

      expect({ settled, workCalls, startCalls, abortCalls }).toEqual({
        settled: { result: 'committed' },
        workCalls: 2,
        startCalls: 2,
        abortCalls: 1,
      });
    } finally {
      jest.useRealTimers();
      await connection.close();
      await client.close();
    }
  });

  it('aborts and propagates a non-retryable failure', async () => {
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const connection = createConnection();
    const failure = new Error('permission denied');
    let inTransaction = false;
    let abortCalls = 0;
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'startTransaction').mockImplementation(() => {
      inTransaction = true;
    });
    jest
      .spyOn(session, 'inTransaction')
      .mockImplementation(() => inTransaction);
    jest.spyOn(session, 'abortTransaction').mockImplementation(() => {
      abortCalls += 1;
      inTransaction = false;
      return Promise.resolve();
    });
    jest.spyOn(session, 'endSession').mockImplementation(() => {
      inTransaction = false;
      return Promise.resolve();
    });

    try {
      const outcome = await withMajorityTransaction(connection, () =>
        Promise.reject(failure),
      ).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );

      expect({ outcome, abortCalls }).toEqual({
        outcome: { error: failure },
        abortCalls: 1,
      });
    } finally {
      await connection.close();
      await client.close();
    }
  });
});

function unknownCommitError(): MongoServerError {
  const error = new MongoServerError({ message: 'lost commit reply' });
  error.addErrorLabel('UnknownTransactionCommitResult');
  return error;
}
