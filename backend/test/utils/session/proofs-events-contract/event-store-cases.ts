import { UniqueConflictError } from '../../../../src/common/persistence/persistence-errors';
import {
  CASE_TIMEOUT_MS,
  contractEvent,
  HarnessSource,
  inUnitOfWork,
  NOW,
  rejectionOf,
} from './proofs-events-contract-support';

const EARLIER = new Date('2099-01-01T11:00:00.000Z');
const LATER = new Date('2099-01-01T13:00:00.000Z');

/** The event store's appends, its read for an investigation, and its cleanup. */
export function eventStoreCases(harness: HarnessSource): void {
  const conflictOf = (failure: unknown) => ({
    conflict: failure instanceof UniqueConflictError,
    constraint:
      failure instanceof UniqueConflictError ? failure.constraint : null,
  });

  it(
    'gives back every field of an event exactly as it was appended',
    async () => {
      const userId = harness().ownAccountId();
      await inUnitOfWork(harness(), (unitOfWork) =>
        harness().events.append(
          unitOfWork,
          contractEvent('event-full', {
            actorId: 'actor-1',
            targetUserId: userId,
            clientId: 'web',
            sessionId: 'session-1',
            action: 'sessions_revoked_all',
            reasonCode: 'admin_forced',
            requestId: 'request-1',
            outcome: 'failed',
            occurredAt: EARLIER,
            roleAssignment: {
              assignedRoleId: 'role-new',
              previousRoleId: 'role-old',
              sessionVersion: 3,
            },
          }),
        ),
      );
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-bare', { targetUserId: userId }),
      );

      expect(await harness().events.listRecentForUser(userId, 10)).toEqual([
        {
          eventId: 'event-bare',
          actorId: null,
          targetUserId: userId,
          clientId: null,
          sessionId: null,
          action: 'contract.event',
          reasonCode: null,
          requestId: null,
          outcome: 'succeeded',
          occurredAt: NOW,
          roleAssignment: null,
          roleDeletionSweep: null,
        },
        {
          eventId: 'event-full',
          actorId: 'actor-1',
          targetUserId: userId,
          clientId: 'web',
          sessionId: 'session-1',
          action: 'sessions_revoked_all',
          reasonCode: 'admin_forced',
          requestId: 'request-1',
          outcome: 'failed',
          occurredAt: EARLIER,
          roleAssignment: {
            assignedRoleId: 'role-new',
            previousRoleId: 'role-old',
            sessionVersion: 3,
          },
          roleDeletionSweep: null,
        },
      ]);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'keeps ids of either database as the text it was given',
    async () => {
      const own = harness().ownAccountId();
      const foreign = harness().foreignAccountId();
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-own', {
          targetUserId: own,
          actorId: foreign,
          sessionId: own,
        }),
      );
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('event-foreign', {
          targetUserId: foreign,
          actorId: own,
          sessionId: foreign,
        }),
      );

      const ids = (userId: string) =>
        harness()
          .events.listRecentForUser(userId, 10)
          .then((events) =>
            events.map(({ eventId, targetUserId, actorId, sessionId }) => ({
              eventId,
              targetUserId,
              actorId,
              sessionId,
            })),
          );

      expect({ own: await ids(own), foreign: await ids(foreign) }).toEqual({
        own: [
          {
            eventId: 'event-own',
            targetUserId: own,
            actorId: foreign,
            sessionId: own,
          },
        ],
        foreign: [
          {
            eventId: 'event-foreign',
            targetUserId: foreign,
            actorId: own,
            sessionId: foreign,
          },
        ],
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'refuses an event id that is already stored, outside a unit of work',
    async () => {
      await harness().events.appendOutsideUnitOfWork(contractEvent('event-1'));

      const failure = await rejectionOf(
        harness().events.appendOutsideUnitOfWork(
          contractEvent('event-1', { action: 'contract.second' }),
        ),
      );

      expect({
        ...conflictOf(failure),
        stored: await harness().storedEventIds(),
      }).toEqual({
        conflict: true,
        constraint: 'security_event.event_id',
        stored: ['event-1'],
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'lists one account newest first, the later append first within an instant',
    async () => {
      const userId = harness().ownAccountId();
      const other = harness().foreignAccountId();
      const append = (eventId: string, occurredAt: Date, target = userId) =>
        harness().events.appendOutsideUnitOfWork(
          contractEvent(eventId, { targetUserId: target, occurredAt }),
        );
      await append('middle-first', NOW);
      await append('oldest', EARLIER);
      await append('newest', LATER);
      await append('someone-else', LATER, other);
      await append('middle-second', NOW);
      await harness().events.appendOutsideUnitOfWork(
        contractEvent('no-target', { occurredAt: LATER }),
      );

      const listed = async (limit: number, target = userId) =>
        (await harness().events.listRecentForUser(target, limit)).map(
          ({ eventId }) => eventId,
        );

      expect({
        all: await listed(10),
        exactly: await listed(4),
        firstTwo: await listed(2),
        none: await listed(0),
        stranger: await listed(10, 'nobody'),
      }).toEqual({
        all: ['newest', 'middle-second', 'middle-first', 'oldest'],
        exactly: ['newest', 'middle-second', 'middle-first', 'oldest'],
        firstTwo: ['newest', 'middle-second'],
        none: [],
        stranger: [],
      });
    },
    CASE_TIMEOUT_MS,
  );
}
