import { UniqueConflictError } from '../../../../src/common/persistence/persistence-errors';
import {
  contractEvent,
  HarnessSource,
  rejectionOf,
} from './proofs-events-contract-support';

/** Conflicting event identifiers fail without replacing the stored event. */
export function eventStoreCases(harness: HarnessSource): void {
  const conflictOf = (failure: unknown) => ({
    conflict: failure instanceof UniqueConflictError,
    constraint:
      failure instanceof UniqueConflictError ? failure.constraint : null,
  });

  it('refuses an event id that is already stored, outside a unit of work', async () => {
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
  });
}
