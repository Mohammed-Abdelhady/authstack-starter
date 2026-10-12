import crypto from 'node:crypto';

/** Action of the stored event that a refused security event collides with. */
export const REFUSED_EVENT_SEED_ACTION = 'test.refused-event-seed';
export const REFUSED_EVENT_SEED_OUTCOME = 'seeded';
export const REFUSED_EVENT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Gives every new security event the id a stored one already owns, so the
 * database's unique rule refuses the insert. Only randomness is replaced.
 */
export function issueOnlyTheRefusedEventId(): () => void {
  const spy = jest
    .spyOn(crypto, 'randomUUID')
    .mockReturnValue(REFUSED_EVENT_ID);
  return () => spy.mockRestore();
}
