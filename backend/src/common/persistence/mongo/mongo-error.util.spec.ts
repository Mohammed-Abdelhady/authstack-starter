import { Error as MongooseError, Mongoose, Schema } from 'mongoose';
import {
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoServerError,
  MongoServerSelectionError,
  MongoNotConnectedError,
  MongoTopologyClosedError,
  MongoWriteConcernError,
} from 'mongodb';
import type { TopologyDescription } from 'mongodb';
import { partialMock } from '../../testing/test-doubles.harness-spec';
import {
  describeDriverError,
  isDatabaseUnavailableError,
} from './mongo-error.util';
import { MONGO_TRANSIENT_TRANSACTION_LABEL } from '../../constants/mongo-errors';
import { UnknownTransactionOutcomeError } from '../../exceptions/unknown-transaction-outcome.error';

const mongoose = new Mongoose();
const document = new (mongoose.model(
  'ErrorProbe',
  new Schema({ role: String }),
))({ role: 'user' });
// Mongoose's constructor declaration accepts a string, but its implementation needs a document.
const parallelSave: unknown = Reflect.construct(
  MongooseError.ParallelSaveError,
  [document],
);
const selection = new MongoServerSelectionError(
  'no primary',
  partialMock<TopologyDescription>({ type: 'Unknown', servers: new Map() }),
);
const labelledServerError = new MongoServerError({
  message: 'retry transaction',
  code: 2,
});
labelledServerError.addErrorLabel(MONGO_TRANSIENT_TRANSACTION_LABEL);
const unknownCommitCause = new MongoTopologyClosedError();

const CASES: Array<{ label: string; error: unknown; unavailable: boolean }> = [
  {
    label: 'labelled server rejection',
    error: labelledServerError,
    unavailable: true,
  },
  {
    label: 'not connected',
    error: new MongoNotConnectedError('closed'),
    unavailable: true,
  },
  {
    label: 'topology closed',
    error: new MongoTopologyClosedError(),
    unavailable: true,
  },
  {
    label: 'write concern class',
    error: new MongoWriteConcernError({
      ok: 0,
      writeConcernError: { code: 100, errmsg: 'cannot acknowledge write' },
    }),
    unavailable: true,
  },
  {
    label: 'label on a non-driver error',
    error: { errorLabels: [MONGO_TRANSIENT_TRANSACTION_LABEL] },
    unavailable: true,
  },
  {
    label: 'unknown commit outcome',
    error: new UnknownTransactionOutcomeError(unknownCommitCause),
    unavailable: true,
  },
  ...[
    { label: 'socket exception', code: 9001 },
    { label: 'max time expired', code: 50 },
    { label: 'time limit exceeded', code: 262 },
    { label: 'lock timeout', code: 24 },
    { label: 'missing transaction', code: 251 },
    { label: 'read preference unavailable', code: 133 },
    { label: 'write concern code', code: 64 },
  ].map(({ label, code }) => ({
    label,
    error: new MongoServerError({ message: label, code }),
    unavailable: true,
  })),
  {
    label: 'network',
    error: new MongoNetworkError('disconnected'),
    unavailable: true,
  },
  {
    label: 'network timeout',
    error: new MongoNetworkTimeoutError('timeout'),
    unavailable: true,
  },
  { label: 'driver selection', error: selection, unavailable: true },
  {
    label: 'mongoose selection',
    error: new MongooseError.MongooseServerSelectionError('no primary'),
    unavailable: true,
  },
  {
    label: 'buffer timeout',
    error: new MongooseError('Operation buffering timed out after 10000ms'),
    unavailable: true,
  },
  {
    label: 'not primary',
    error: new MongoServerError({ message: 'not primary', code: 10107 }),
    unavailable: true,
  },
  {
    label: 'primary stepped down',
    error: new MongoServerError({ message: 'step down', code: 189 }),
    unavailable: true,
  },
  {
    label: 'interrupted',
    error: new MongoServerError({ message: 'interrupted', code: 11601 }),
    unavailable: true,
  },
  {
    label: 'exhausted write conflict',
    error: new MongoServerError({ message: 'conflict', code: 112 }),
    unavailable: true,
  },
  {
    label: 'duplicate key',
    error: new MongoServerError({ message: 'duplicate', code: 11000 }),
    unavailable: false,
  },
  {
    label: 'server validation',
    error: new MongoServerError({ message: 'invalid', code: 121 }),
    unavailable: false,
  },
  {
    label: 'server authorization',
    error: new MongoServerError({ message: 'denied', code: 13 }),
    unavailable: false,
  },
  {
    label: 'unclassified server rejection',
    error: new MongoServerError({ message: 'rejected' }),
    unavailable: false,
  },
  {
    label: 'mongoose validation',
    error: new MongooseError.ValidationError(),
    unavailable: false,
  },
  {
    label: 'cast',
    error: new MongooseError.CastError('ObjectId', 'invalid', '_id'),
    unavailable: false,
  },
  {
    label: 'version',
    error: new MongooseError.VersionError(document, 1, ['role']),
    unavailable: false,
  },
  {
    label: 'parallel save',
    error: parallelSave,
    unavailable: false,
  },
  {
    label: 'programming error',
    error: new TypeError('bug'),
    unavailable: false,
  },
  { label: 'null', error: null, unavailable: false },
  { label: 'undefined', error: undefined, unavailable: false },
];

describe('database availability classification', () => {
  it.each(CASES)('$label', ({ error, unavailable }) => {
    expect(isDatabaseUnavailableError(error)).toBe(unavailable);
  });
});

describe('driver error descriptions omit personal values', () => {
  it.each([
    {
      error: new MongoServerError({
        message: 'duplicate private@example.test',
        code: 11000,
      }),
      expected: 'name=MongoServerError code=11000',
    },
    {
      error: new MongoNetworkError(
        'connection failed for private@example.test',
      ),
      expected: 'name=MongoNetworkError',
    },
    {
      error: new UnknownTransactionOutcomeError(
        new MongoServerError({ message: 'sensitive driver text', code: 91 }),
      ),
      expected:
        'name=UnknownTransactionOutcomeError cause=name=MongoServerError code=91',
    },
    {
      error: {
        name: 'private@example.test',
        code: 'Private Name',
        message: 'sensitive',
      },
      expected: 'name=unprintable code=unprintable',
    },
    { error: null, expected: 'non-object object' },
    { error: undefined, expected: 'non-object undefined' },
  ])('describes $expected without a driver message', ({ error, expected }) => {
    expect(describeDriverError(error)).toBe(expected);
  });
});
