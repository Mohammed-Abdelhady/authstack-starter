import { rowSlices } from './postgres-bind-parameters';

const rowsOf = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index);

describe('rowSlices', () => {
  it('gives no slice for no rows', () => {
    expect(rowSlices([], 17)).toEqual([]);
  });

  it('keeps 3,855 rows of 17 columns in one statement, 65,535 parameters', () => {
    expect(rowSlices(rowsOf(3855), 17).map((slice) => slice.length)).toEqual([
      3855,
    ]);
  });

  it('moves the row that would be parameter 65,536 into a second statement', () => {
    expect(rowSlices(rowsOf(3856), 17).map((slice) => slice.length)).toEqual([
      3855, 1,
    ]);
  });

  it('keeps every row once and in order across slices', () => {
    expect(rowSlices(rowsOf(7), 30000)).toEqual([[0, 1], [2, 3], [4, 5], [6]]);
  });

  it('gives a one-column row the whole limit', () => {
    expect(rowSlices(rowsOf(65536), 1).map((slice) => slice.length)).toEqual([
      65535, 1,
    ]);
  });
});
