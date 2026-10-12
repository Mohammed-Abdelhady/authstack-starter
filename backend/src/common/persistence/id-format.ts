/**
 * What this installation's database takes as an id. The adapter answers, so
 * nothing above it knows a format.
 */
export abstract class IdFormat {
  /** True when this database could have issued the id. */
  abstract isId(id: string): boolean;
}
