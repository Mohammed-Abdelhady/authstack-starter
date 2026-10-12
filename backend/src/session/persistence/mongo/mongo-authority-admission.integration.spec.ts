import { PersistenceUnavailableError } from '../../../common/persistence/persistence-errors';
import { useAdminRoundFour } from '../../../admin/persistence/mongo/services/admin-round-four.harness-spec';
import { RaceGate } from '../../../../test/utils/race-gate';
import { MongoUnitOfWorkRunner, mongoSessionOf } from './mongo-unit-of-work';

const OBSERVATIONS = 'authority_admission_observations';

describe('Mongo authority queue admission', () => {
  const fixture = useAdminRoundFour('authority_admission');

  const observations = () => {
    const database = fixture.h.connection.db;
    if (!database) throw new Error('Mongo fixture has no database');
    return database.collection<{ actor: string; operation: number }>(
      OBSERVATIONS,
    );
  };

  beforeAll(async () => {
    await fixture.h.connection.createCollection(OBSERVATIONS);
  });
  beforeEach(async () => {
    await observations().deleteMany({});
  });

  it('refuses the thirty-third operation for one held actor and frees admission after commit', async () => {
    const runner = new MongoUnitOfWorkRunner(fixture.h.connection);
    const gate = new RaceGate();
    const accepted = Array.from({ length: 32 }, (_, operation) =>
      runner.runForAuthority('actor-one', async (work) => {
        await gate.hold();
        await observations().insertOne(
          { actor: 'actor-one', operation },
          { session: mongoSessionOf(work) },
        );
      }),
    );
    await gate.reached();
    let refusal: unknown;
    let started = false;
    const overflow = runner
      .runForAuthority('actor-one', () => {
        started = true;
        return Promise.resolve();
      })
      .catch((error: unknown) => {
        refusal = error;
      });
    try {
      await Promise.resolve();
      expect(refusal).toBeInstanceOf(PersistenceUnavailableError);
      expect(started).toBe(false);
      await runner.runForAuthority('other-actor', async (work) => {
        await observations().insertOne(
          { actor: 'other-actor', operation: 0 },
          { session: mongoSessionOf(work) },
        );
      });
      expect(
        await observations().countDocuments({ actor: 'other-actor' }),
      ).toBe(1);
    } finally {
      gate.release();
      await Promise.allSettled([...accepted, overflow]);
    }
    await Promise.all(accepted);
    expect(await observations().countDocuments({ actor: 'actor-one' })).toBe(
      32,
    );
    await runner.runForAuthority('actor-one', async (work) => {
      await observations().insertOne(
        { actor: 'actor-one', operation: 32 },
        { session: mongoSessionOf(work) },
      );
    });
    expect(await observations().countDocuments({ actor: 'actor-one' })).toBe(
      33,
    );
  });

  it('refuses total work beyond 256 and releases every key after a failed transaction', async () => {
    const runner = new MongoUnitOfWorkRunner(fixture.h.connection);
    const gate = new RaceGate();
    const failure = new Error('Held transaction failed');
    const accepted = Array.from({ length: 256 }, (_, operation) =>
      runner
        .runForAuthority(`actor-${operation % 16}`, async () => {
          await gate.hold();
          throw failure;
        })
        .catch((error: unknown) => error),
    );
    await gate.reached(16);
    let refusal: unknown;
    let started = false;
    const overflow = runner
      .runForAuthority('extra-actor', () => {
        started = true;
        return Promise.resolve();
      })
      .catch((error: unknown) => {
        refusal = error;
      });
    try {
      await Promise.resolve();
      expect(refusal).toBeInstanceOf(PersistenceUnavailableError);
      expect(started).toBe(false);
    } finally {
      gate.release();
      await Promise.all([...accepted, overflow]);
    }
    for (const result of await Promise.all(accepted))
      expect(result).toBe(failure);
    await Promise.all(
      Array.from({ length: 16 }, (_, actor) =>
        runner.runForAuthority(`actor-${actor}`, async (work) => {
          await observations().insertOne(
            { actor: `actor-${actor}`, operation: 0 },
            { session: mongoSessionOf(work) },
          );
        }),
      ),
    );
    expect(await observations().countDocuments()).toBe(16);
  });
});
