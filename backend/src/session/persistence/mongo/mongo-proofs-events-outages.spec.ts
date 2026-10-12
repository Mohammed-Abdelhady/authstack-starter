import { MongoNetworkError } from 'mongodb';
import { Model } from 'mongoose';
import { raisedBy } from '../../../../test/utils/auth/store-outage-cases';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  PROOFS_EVENTS_OUTAGES,
  proofsEventsStatements,
} from '../../../../test/utils/session/proofs-events-contract/proofs-events-outage-cases';
import { createModelMock } from '../../../common/testing/test-doubles.harness-spec';
import { BrowserProofDocument } from './schemas/browser-proof.schema';
import { SecurityEventDocument } from './schemas/security-event.schema';
import { SecurityEventService } from './security-event.service';
import { MongoBrowserProofStore } from './mongo-browser-proof.store';
import { MongoSecurityEventStore } from './mongo-security-event.store';

const OUTAGE = new MongoNetworkError('connection 3 to 10.0.0.9 closed');
const away = (): jest.Mock => jest.fn().mockRejectedValue(OUTAGE);

/** A query whose every link answers itself and whose `exec` meets the outage. */
function awayQuery(): jest.Mock {
  const query = {
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: away(),
  };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return jest.fn().mockReturnValue(query);
}

function eventModelAway(): Model<SecurityEventDocument> {
  return createModelMock<Model<SecurityEventDocument>>({
    create: away(),
    find: awayQuery(),
    deleteMany: awayQuery(),
  });
}

describe('MongoDB proof and event statements that commit by themselves', () => {
  it('raises the shared outage from every proof and event statement', async () => {
    const proofs = new MongoBrowserProofStore(
      createModelMock<Model<BrowserProofDocument>>({
        create: away(),
        findOne: awayQuery(),
        updateOne: awayQuery(),
        deleteMany: awayQuery(),
      }),
    );
    const events = new MongoSecurityEventStore(eventModelAway());

    expect(await raisedBy(proofsEventsStatements(proofs, events))).toEqual(
      PROOFS_EVENTS_OUTAGES,
    );
  });

  it('hands callers of the event service the driver error itself', async () => {
    const service = new SecurityEventService(
      eventModelAway(),
      new FrozenClock(TEST_NOW),
    );

    const error: unknown = await service
      .record({ action: 'contract.event' })
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(OUTAGE);
  });
});
