import { MongoNetworkError, MongoServerError } from 'mongodb';
import { ClientSession, Error as MongooseError, Model } from 'mongoose';
import {
  PENDING_CODE_OUTAGES,
  pendingCodeStatements,
  raisedBy,
} from '../../../../test/utils/auth/store-outage-cases';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  MalformedIdError,
  PersistenceTimeoutError,
  PersistenceUnavailableError,
} from '../../../common/persistence/persistence-errors';
import {
  createModelMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { mongoUnitOfWork } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { PENDING_PURPOSE } from '../../constants/registration';
import { MailCounterDocument } from './schemas/mail-counter.schema';
import { PendingPasswordResetDocument } from './schemas/pending-password-reset.schema';
import { PendingRegistrationDocument } from './schemas/pending-registration.schema';
import { MongoMailCounterStore } from './mongo-mail-counter.store';
import { MongoPasswordResetCodeStore } from './mongo-password-reset-code.store';
import { MongoPendingRegistrationStore } from './mongo-pending-registration.store';
import {
  insertOrConflict,
  singleStatement,
} from '../../../common/persistence/mongo/mongo-unique-conflict';

const AN_OBJECT_ID = '65f000000000000000000001';
const OUTAGE = new MongoNetworkError('connection 3 to 10.0.0.9 closed');

function serverError(code: number, label?: string): MongoServerError {
  const error = new MongoServerError({ message: `server refused: ${code}` });
  error.code = code;
  if (label) error.addErrorLabel(label);
  return error;
}

const away = (): jest.Mock => jest.fn().mockRejectedValue(OUTAGE);

function counterModel(): Model<MailCounterDocument> {
  return createModelMock<Model<MailCounterDocument>>({
    findOneAndUpdate: away(),
    exists: away(),
    create: away(),
    deleteMany: away(),
    updateOne: away(),
  });
}

function registrationStore(
  findOneAndDelete: jest.Mock = away(),
): MongoPendingRegistrationStore {
  return new MongoPendingRegistrationStore(
    createModelMock<Model<PendingRegistrationDocument>>({
      findOneAndUpdate: away(),
      exists: away(),
      deleteOne: away(),
      create: away(),
      deleteMany: away(),
      findOneAndDelete,
    }),
    counterModel(),
  );
}

describe('MongoDB statements that commit by themselves', () => {
  describe('singleStatement', () => {
    const raised = (error: Error): Promise<unknown> =>
      singleStatement(() => Promise.reject(error)).then(
        () => 'resolved',
        (thrown: unknown) => thrown,
      );

    it('raises an outage as the shared error over the driver error', async () => {
      const error = await raised(OUTAGE);

      expect(error).toBeInstanceOf(PersistenceUnavailableError);
      expect(Reflect.get(Object(error), 'cause')).toBe(OUTAGE);
    });

    it('raises an expired operation as the shared timeout', async () => {
      const expired = serverError(50);

      const error = await raised(expired);

      expect(error).toBeInstanceOf(PersistenceTimeoutError);
      expect(Reflect.get(Object(error), 'cause')).toBe(expired);
    });

    it.each([
      ['a duplicate key', serverError(11000)],
      ['a cast failure', new MongooseError.CastError('ObjectId', 'x', '_id')],
      [
        'a write conflict a transaction reruns',
        serverError(112, 'TransientTransactionError'),
      ],
      ['an id the adapter refused', new MalformedIdError()],
      [
        'an application error',
        new AppException(ErrorCode.CONFLICT, 'taken', 409),
      ],
      ['any other error', new Error('unexpected')],
    ])('leaves %s as it was raised', async (_name, original) => {
      expect(await raised(original)).toBe(original);
    });
  });

  it('raises an outage during an insert as the shared error', async () => {
    const error: unknown = await insertOrConflict({}, () =>
      Promise.reject(OUTAGE),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PersistenceUnavailableError);
    expect(Reflect.get(Object(error), 'cause')).toBe(OUTAGE);
  });

  it('raises the shared outage from every pending-code statement', async () => {
    const stores = {
      mailCounters: new MongoMailCounterStore(
        createModelMock<Model<MailCounterDocument>>({
          findOneAndUpdate: away(),
          exists: away(),
          create: away(),
          deleteMany: away(),
        }),
      ),
      registrations: registrationStore(),
      passwordResets: new MongoPasswordResetCodeStore(
        createModelMock<Model<PendingPasswordResetDocument>>({
          updateOne: away(),
          create: away(),
          findOneAndUpdate: away(),
          findOneAndDelete: away(),
          deleteOne: away(),
          deleteMany: away(),
        }),
        counterModel(),
      ),
    };

    expect(await raisedBy(pendingCodeStatements(stores, AN_OBJECT_ID))).toEqual(
      PENDING_CODE_OUTAGES,
    );
  });

  it('leaves a failure inside a unit of work to the transaction that owns it', async () => {
    const conflict = serverError(112, 'TransientTransactionError');
    const store = registrationStore(jest.fn().mockRejectedValue(conflict));

    const claim = store.claimCode(
      mongoUnitOfWork(partialMock<ClientSession>({})),
      {
        id: AN_OBJECT_ID,
        purpose: PENDING_PURPOSE.SIGNUP,
        hashedCode: 'hash',
        now: TEST_NOW,
      },
    );

    await expect(claim).rejects.toBe(conflict);
  });
});
