import {
  MongoClient,
  MongoNetworkError,
  MongoServerError,
  MongoServerSelectionError,
  MongoTopologyClosedError,
} from 'mongodb';
import type { TopologyDescription } from 'mongodb';
import { createRequire } from 'node:module';
import { createConnection } from 'mongoose';
import {
  UnknownTransactionOutcomeError,
  isUnknownTransactionOutcome,
  withMajorityTransaction,
} from './mongo-transaction';

interface TopologyDescriptionModule {
  TopologyDescription: new (
    topologyType: 'Unknown',
    serverDescriptions?: Map<string, never> | null,
  ) => TopologyDescription;
}

const loadModule = createRequire(__filename);
const { TopologyDescription: DriverTopologyDescription } = loadModule(
  'mongodb/lib/sdam/topology_description',
) as TopologyDescriptionModule;

describe('commit transaction outcomes', () => {
  it('retries a catalog message before any commit attempt', async () => {
    jest.useFakeTimers();
    try {
      const pending = runPrecommitScript([
        new Error('Please retry your operation'),
      ]);
      await jest.runAllTimersAsync();
      const state = await pending;

      expect({
        outcome: state.outcome,
        workCalls: state.workCalls,
        startCalls: state.startCalls,
        abortCalls: state.abortCalls,
        commitCalls: state.commitCalls,
      }).toEqual({
        outcome: 'committed',
        workCalls: 2,
        startCalls: 2,
        abortCalls: 1,
        commitCalls: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops after the configured number of whole-transaction attempts', async () => {
    jest.useFakeTimers();
    const failures = [
      retryableWorkError(),
      retryableWorkError(),
      retryableWorkError(),
    ];
    const lastFailure = failures[2];
    try {
      const pending = runPrecommitScript(failures);
      await jest.runAllTimersAsync();
      const state = await pending;

      expect({
        outcome: state.outcome,
        workCalls: state.workCalls,
        startCalls: state.startCalls,
        abortCalls: state.abortCalls,
        commitCalls: state.commitCalls,
      }).toEqual({
        outcome: lastFailure,
        workCalls: 3,
        startCalls: 3,
        abortCalls: 3,
        commitCalls: 0,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('recognizes only the helper’s wrapped unknown outcomes', () => {
    const driverError = new MongoNetworkError('connection closed');
    const outcome = new UnknownTransactionOutcomeError(driverError);

    expect(isUnknownTransactionOutcome(outcome)).toBe(true);
    expect(isUnknownTransactionOutcome(driverError)).toBe(false);
  });

  it.each([
    [
      'network error from commit',
      () => {
        const error = new MongoNetworkError('connection closed');
        error.addErrorLabel('RetryableWriteError');
        return error;
      },
    ],
    [
      'server selection error after driver retry',
      () =>
        new MongoServerSelectionError(
          'driver could not select a primary after its commit retry',
          new DriverTopologyDescription('Unknown', new Map<string, never>()),
        ),
    ],
    [
      'closed topology after driver retry',
      () => new MongoTopologyClosedError(),
    ],
  ] as const)(
    'marks %s as an unknown commit outcome',
    async (_name, makeFailure) => {
      const failure = makeFailure();
      const state = await runCommitScript([
        { error: failure, transactionRemains: true },
      ]);

      expect(state.outcome).toBeInstanceOf(UnknownTransactionOutcomeError);
      expect(state.outcome).toMatchObject({
        driverError: failure,
        cause: failure,
      });
      expect({
        workCalls: state.workCalls,
        commitCalls: state.commitCalls,
        abortCalls: state.abortCalls,
      }).toEqual({
        workCalls: 1,
        commitCalls: 1,
        abortCalls: 0,
      });
    },
  );

  it('restarts the whole transaction after a certain transient commit rollback', async () => {
    jest.useFakeTimers();
    const failure = new Error('transaction rolled back');
    Object.defineProperty(failure, 'errorLabels', {
      value: ['TransientTransactionError'],
    });
    try {
      const pending = runCommitScript([
        { error: failure, transactionRemains: true },
        undefined,
      ]);
      await jest.runAllTimersAsync();
      const state = await pending;

      expect(state.outcome).toBe('committed');
      expect({
        workCalls: state.workCalls,
        commitCalls: state.commitCalls,
        abortCalls: state.abortCalls,
      }).toEqual({
        workCalls: 2,
        commitCalls: 2,
        abortCalls: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not treat a catalog retry message as rollback after commit was attempted', async () => {
    jest.useFakeTimers();
    const failure = new MongoServerError({
      message: 'Please retry your operation after the commit result is unknown',
      code: 64,
    });
    try {
      const pending = runCommitScript([
        { error: failure, transactionRemains: true },
        undefined,
      ]);
      await jest.runAllTimersAsync();
      const state = await pending;

      expect(state.outcome).toBeInstanceOf(UnknownTransactionOutcomeError);
      expect({
        workCalls: state.workCalls,
        commitCalls: state.commitCalls,
        abortCalls: state.abortCalls,
      }).toEqual({ workCalls: 1, commitCalls: 1, abortCalls: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
});

function retryableWorkError(): Error {
  const failure = new Error('transient write conflict');
  Object.defineProperty(failure, 'errorLabels', {
    value: ['TransientTransactionError'],
  });
  return failure;
}

async function runPrecommitScript(failures: Error[]) {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  const session = client.startSession();
  const connection = createConnection();
  let inTransaction = false;
  let workCalls = 0;
  let startCalls = 0;
  let abortCalls = 0;
  let commitCalls = 0;
  jest.spyOn(connection, 'startSession').mockResolvedValue(session);
  jest.spyOn(session, 'startTransaction').mockImplementation(() => {
    startCalls += 1;
    inTransaction = true;
  });
  jest.spyOn(session, 'inTransaction').mockImplementation(() => inTransaction);
  jest.spyOn(session, 'abortTransaction').mockImplementation(() => {
    abortCalls += 1;
    inTransaction = false;
    return Promise.resolve();
  });
  jest.spyOn(session, 'commitTransaction').mockImplementation(() => {
    commitCalls += 1;
    inTransaction = false;
    return Promise.resolve();
  });
  jest.spyOn(session, 'endSession').mockResolvedValue(undefined);

  try {
    const outcome = await withMajorityTransaction(connection, () => {
      workCalls += 1;
      const failure = failures.shift();
      return failure ? Promise.reject(failure) : Promise.resolve('committed');
    }).catch((error: unknown) => error);
    return { outcome, workCalls, startCalls, abortCalls, commitCalls };
  } finally {
    await connection.close();
    await client.close();
  }
}

interface CommitFailureStep {
  error: Error;
  transactionRemains: boolean;
}

async function runCommitScript(failures: Array<CommitFailureStep | undefined>) {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  const session = client.startSession();
  const connection = createConnection();
  let inTransaction = false;
  let workCalls = 0;
  let commitCalls = 0;
  let abortCalls = 0;
  jest.spyOn(connection, 'startSession').mockResolvedValue(session);
  jest.spyOn(session, 'startTransaction').mockImplementation(() => {
    inTransaction = true;
  });
  jest.spyOn(session, 'inTransaction').mockImplementation(() => inTransaction);
  jest.spyOn(session, 'commitTransaction').mockImplementation(() => {
    commitCalls += 1;
    const failure = failures.shift();
    if (failure) {
      inTransaction = failure.transactionRemains;
      return Promise.reject(failure.error);
    }
    inTransaction = false;
    return Promise.resolve();
  });
  jest.spyOn(session, 'abortTransaction').mockImplementation(() => {
    abortCalls += 1;
    inTransaction = false;
    return Promise.resolve();
  });
  // Count explicit helper aborts without the driver's endSession cleanup.
  jest.spyOn(session, 'endSession').mockResolvedValue(undefined);

  try {
    const outcome = await withMajorityTransaction(connection, () => {
      workCalls += 1;
      return Promise.resolve('committed');
    }).catch((error: unknown) => error);
    return { outcome, workCalls, commitCalls, abortCalls };
  } finally {
    jest.restoreAllMocks();
    await connection.close();
    await client.close();
  }
}
