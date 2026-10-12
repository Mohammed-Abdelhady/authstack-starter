export const STORE_HEALTH = {
  /** Reachable, and the primary that takes writes. */
  READY: 'ready',
  /** Reachable, but writes would be refused here. */
  NOT_WRITABLE: 'not_writable',
  UNREACHABLE: 'unreachable',
} as const;

export type StoreHealthState = (typeof STORE_HEALTH)[keyof typeof STORE_HEALTH];

/**
 * Whether the store can serve the application now: is it reachable, and is it
 * the primary able to take writes.
 *
 * The answer is what the adapter last observed. It never waits on the database,
 * so a health probe stays cheap and cannot hang with the store. How an adapter
 * keeps its observation fresh is its own business.
 */
export abstract class StoreHealth {
  abstract current(): StoreHealthState;
}
