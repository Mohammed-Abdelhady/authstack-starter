import { MongoNetworkError } from 'mongodb';
import { Model, Types } from 'mongoose';
import { PersistenceUnavailableError } from '../../../../common/persistence/persistence-errors';
import {
  createModelMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';
import { raisedBy } from '../../../../../test/utils/auth/store-outage-cases';
import { MailCounterDocument } from '../../../persistence/mongo/schemas/mail-counter.schema';
import { UserDocument } from '../../../../user/persistence/mongo/schemas/user.schema';
import {
  MAGIC_LINK_OUTAGES,
  magicLinkStatements,
} from '../../contract/magic-link-outage-cases.harness-spec';
import { PendingMagicLinkDocument } from './schemas/pending-magic-link.schema';
import { MongoMagicLinkAccounts } from './mongo-magic-link-accounts';
import { MongoMagicLinkStore } from './mongo-magic-link.store';

const OUTAGE = new MongoNetworkError('connection 3 to 10.0.0.9 closed');
const away = (): jest.Mock => jest.fn().mockRejectedValue(OUTAGE);

describe('MongoDB magic link statements that commit by themselves', () => {
  it('raises the shared outage from every link and account statement', async () => {
    const links = new MongoMagicLinkStore(
      createModelMock<Model<PendingMagicLinkDocument>>({
        create: away(),
        findOneAndUpdate: away(),
        deleteMany: away(),
      }),
      createModelMock<Model<MailCounterDocument>>({
        findOneAndUpdate: away(),
      }),
    );
    const accounts = new MongoMagicLinkAccounts(
      createModelMock<Model<UserDocument>>({
        findOne: away(),
        exists: away(),
        create: away(),
      }),
    );

    expect(await raisedBy(magicLinkStatements(links, accounts))).toEqual(
      MAGIC_LINK_OUTAGES,
    );
  });

  it('raises the shared outage when the account cannot be saved as verified', async () => {
    const stored = partialMock<UserDocument>({
      _id: new Types.ObjectId('65f000000000000000000001'),
      isVerified: false,
      save: away(),
    });
    const accounts = new MongoMagicLinkAccounts(
      createModelMock<Model<UserDocument>>({
        findOne: jest.fn().mockResolvedValue(stored),
      }),
    );
    const account = await accounts.findByEmail('outage@example.test');
    if (!account) throw new Error('the account was not read');

    const error: unknown = await accounts
      .markVerified(account)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PersistenceUnavailableError);
    expect(Reflect.get(Object(error), 'cause')).toBe(OUTAGE);
  });
});
