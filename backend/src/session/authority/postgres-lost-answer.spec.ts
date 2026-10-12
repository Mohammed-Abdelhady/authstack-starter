import { lostAnswerOutcome } from '../../common/persistence/postgres/postgres-unit-of-work';

describe('what a lost commit answer becomes on PostgreSQL', () => {
  it.each([
    ['committed', 'committed'],
    ['aborted', 'not_committed'],
    ['in progress', 'unknown'],
    ['COMMITTED', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ])('reads a transaction status of %p as %s', (status, outcome) => {
    expect(lostAnswerOutcome(status)).toBe(outcome);
  });
});
