import { UniqueConflictError } from '../../../../src/common/persistence/persistence-errors';
import {
  CASE_TIMEOUT_MS,
  contractEvent,
  HarnessSource,
  inUnitOfWork,
  NOW,
  rejectionOf,
} from './proofs-events-contract-support';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLE_ID = '65f0000000000000000000aa';
/** Above the 3,855 rows of 17 columns a statement of 65,535 parameters holds. */
const LARGE_BATCH = 4000;

/** An event shares the fate of the unit of work it was appended in. */
export function eventAtomicityCases(harness: HarnessSource): void {
  it(
    'stores an event when its unit of work commits and none when the work throws',
    async () => {
      const stop = new Error('the caller changed its mind');

      await inUnitOfWork(harness(), (unitOfWork) =>
        harness().events.append(unitOfWork, contractEvent('event-kept')),
      );
      const failure = await rejectionOf(
        inUnitOfWork(harness(), async (unitOfWork) => {
          await harness().events.append(unitOfWork, contractEvent('event-a'));
          await harness().events.appendMany(unitOfWork, [
            contractEvent('event-b'),
            contractEvent('event-c'),
          ]);
          throw stop;
        }),
      );

      expect({
        sameError: failure === stop,
        stored: await harness().storedEventIds(),
      }).toEqual({ sameError: true, stored: ['event-kept'] });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'fails the whole unit of work when the database refuses one of its events',
    async () => {
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-taken'),
      );

      const failure = await rejectionOf(
        inUnitOfWork(harness(), async (unitOfWork) => {
          await harness().events.append(unitOfWork, contractEvent('event-new'));
          await harness().events.append(
            unitOfWork,
            contractEvent('event-taken'),
          );
        }),
      );

      expect({
        conflict: failure instanceof UniqueConflictError,
        constraint:
          failure instanceof UniqueConflictError ? failure.constraint : null,
        stored: await harness().storedEventIds(),
      }).toEqual({
        conflict: true,
        constraint: 'security_event.event_id',
        stored: ['event-taken'],
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'reports failure, and stores nothing, when the work swallowed a refused event',
    async () => {
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-taken'),
      );

      const failure = await rejectionOf(
        inUnitOfWork(harness(), async (unitOfWork) => {
          await harness().events.append(unitOfWork, contractEvent('event-new'));
          await harness()
            .events.append(unitOfWork, contractEvent('event-taken'))
            .catch(() => undefined);
          return 'the work believes it succeeded';
        }),
      );

      expect({
        failed: failure instanceof Error,
        stored: await harness().storedEventIds(),
      }).toEqual({ failed: true, stored: ['event-taken'] });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'stores every event of a batch or none of them',
    async () => {
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-taken'),
      );

      await inUnitOfWork(harness(), async (unitOfWork) => {
        await harness().events.appendMany(unitOfWork, []);
        await harness().events.appendMany(unitOfWork, [
          contractEvent('batch-1'),
          contractEvent('batch-2'),
        ]);
      });
      const failure = await rejectionOf(
        inUnitOfWork(harness(), (unitOfWork) =>
          harness().events.appendMany(unitOfWork, [
            contractEvent('refused-1'),
            contractEvent('refused-2'),
            contractEvent('event-taken'),
          ]),
        ),
      );

      expect({
        conflict: failure instanceof UniqueConflictError,
        stored: await harness().storedEventIds(),
      }).toEqual({
        conflict: true,
        stored: ['batch-1', 'batch-2', 'event-taken'],
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'stores a batch of 4,000 events, more rows than one statement can bind',
    async () => {
      const userId = harness().ownAccountId();
      const batch = Array.from({ length: LARGE_BATCH }, (_, index) =>
        contractEvent(`large-${String(index).padStart(4, '0')}`, {
          targetUserId: userId,
          actorId: 'actor-1',
          reasonCode: 'admin_forced',
        }),
      );

      await inUnitOfWork(harness(), (unitOfWork) =>
        harness().events.appendMany(unitOfWork, batch),
      );

      const stored = await harness().storedEventIds();
      const [newest] = await harness().events.listRecentForUser(userId, 1);
      expect({
        stored: stored.length,
        first: stored[0],
        last: stored[stored.length - 1],
        newest: {
          eventId: newest.eventId,
          actorId: newest.actorId,
          targetUserId: newest.targetUserId,
          reasonCode: newest.reasonCode,
          occurredAt: newest.occurredAt,
        },
      }).toEqual({
        stored: 4000,
        first: 'large-0000',
        last: 'large-3999',
        newest: {
          eventId: 'large-3999',
          actorId: 'actor-1',
          targetUserId: userId,
          reasonCode: 'admin_forced',
          occurredAt: NOW,
        },
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'stores none of a batch of 4,000 events when the database refuses its last one',
    async () => {
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-taken'),
      );
      const batch = Array.from({ length: LARGE_BATCH - 1 }, (_, index) =>
        contractEvent(`large-${String(index).padStart(4, '0')}`),
      );

      const failure = await rejectionOf(
        inUnitOfWork(harness(), (unitOfWork) =>
          harness().events.appendMany(unitOfWork, [
            ...batch,
            contractEvent('event-taken'),
          ]),
        ),
      );

      expect({
        conflict: failure instanceof UniqueConflictError,
        stored: await harness().storedEventIds(),
      }).toEqual({ conflict: true, stored: ['event-taken'] });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'records through the recorder with a fresh id, the clock and a default outcome',
    async () => {
      const userId = harness().ownAccountId();
      await inUnitOfWork(harness(), async (unitOfWork) => {
        await harness().recorder.record(unitOfWork, {
          targetUserId: userId,
          clientId: 'mobile',
          action: 'refresh_replay',
        });
        await harness().recorder.recordMany(unitOfWork, []);
      });
      harness().clock.advance(1000);
      await inUnitOfWork(harness(), (unitOfWork) =>
        harness().recorder.recordMany(unitOfWork, [
          { targetUserId: userId, action: 'batch.one', outcome: 'failed' },
          { targetUserId: userId, action: 'batch.two' },
        ]),
      );
      harness().clock.advance(1000);
      await harness().recorder.recordOutsideUnitOfWork({
        targetUserId: userId,
        action: 'proof_refused',
        reasonCode: 'bad_proof',
      });

      const events = await harness().events.listRecentForUser(userId, 10);

      expect({
        fresh: events.every(({ eventId }) => UUID.test(eventId)),
        distinct: new Set(events.map(({ eventId }) => eventId)).size,
        events: events.map(
          ({ action, clientId, reasonCode, outcome, occurredAt }) => ({
            action,
            clientId,
            reasonCode,
            outcome,
            occurredAt,
          }),
        ),
      }).toEqual({
        fresh: true,
        distinct: 4,
        events: [
          {
            action: 'proof_refused',
            clientId: null,
            reasonCode: 'bad_proof',
            outcome: 'succeeded',
            occurredAt: new Date('2099-01-01T12:00:02.000Z'),
          },
          {
            action: 'batch.two',
            clientId: null,
            reasonCode: null,
            outcome: 'succeeded',
            occurredAt: new Date('2099-01-01T12:00:01.000Z'),
          },
          {
            action: 'batch.one',
            clientId: null,
            reasonCode: null,
            outcome: 'failed',
            occurredAt: new Date('2099-01-01T12:00:01.000Z'),
          },
          {
            action: 'refresh_replay',
            clientId: 'mobile',
            reasonCode: null,
            outcome: 'succeeded',
            occurredAt: NOW,
          },
        ],
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'records a role deletion once under the id of the role',
    async () => {
      const deletion = {
        roleId: ROLE_ID,
        previousSlug: 'content-editor',
        actorId: 'actor-1',
        sweepId: 'sweep-1',
      };
      await inUnitOfWork(harness(), (unitOfWork) =>
        harness().recorder.recordRoleDeletion(unitOfWork, deletion),
      );

      const failure = await rejectionOf(
        inUnitOfWork(harness(), (unitOfWork) =>
          harness().recorder.recordRoleDeletion(unitOfWork, {
            ...deletion,
            actorId: 'actor-2',
          }),
        ),
      );

      expect({
        conflict: failure instanceof UniqueConflictError,
        stored: await harness().storedEventIds(),
      }).toEqual({
        conflict: true,
        stored: [`role-deletion:${ROLE_ID}`],
      });
    },
    CASE_TIMEOUT_MS,
  );
}
