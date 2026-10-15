import { describe, expect, it } from 'vitest';
import { descendantGroups, parseProcessRows } from './signal-process-groups.js';

describe('signal process table parser', () => {
  it('reads decimal columns and ignores malformed or unsafe rows', () => {
    const table = [
      ' 100 0 100 ',
      '101\t100\t100',
      '',
      '   ',
      'pid ppid pgid',
      '102 100',
      '102 100 102 extra',
      '102 -1 102',
      '102 100 1.02e2',
      '0 100 100',
      '1 100 100',
      '102 100 0',
      '102 100 1',
      '9007199254740992 100 102',
      '102 9007199254740992 102',
      '102 100 9007199254740992',
      '102 100 102',
    ].join('\n');
    expect(parseProcessRows(table)).toEqual([
      { pid: 100, ppid: 0, pgid: 100 },
      { pid: 101, ppid: 100, pgid: 100 },
      { pid: 102, ppid: 100, pgid: 102 },
    ]);
  });

  it.each(['', ' \n\t'])('returns no rows for %j', (table) => {
    expect(parseProcessRows(table)).toEqual([]);
  });
});

const WALKER_CASES = [
  {
    name: 'a leader and a child in its group',
    rows: [
      { pid: 100, ppid: 500, pgid: 100 },
      { pid: 101, ppid: 100, pgid: 100 },
    ],
    expected: [100],
  },
  {
    name: 'an escaped child before its leader',
    rows: [
      { pid: 100, ppid: 500, pgid: 100 },
      { pid: 200, ppid: 100, pgid: 200 },
    ],
    expected: [200, 100],
  },
  {
    name: 'a grandchild escaped from an escaped child',
    rows: [
      { pid: 300, ppid: 200, pgid: 300 },
      { pid: 200, ppid: 100, pgid: 200 },
      { pid: 100, ppid: 500, pgid: 100 },
    ],
    expected: [200, 300, 100],
  },
  {
    name: 'a foreign group without claiming its leader or members',
    rows: [
      { pid: 100, ppid: 500, pgid: 100 },
      { pid: 200, ppid: 100, pgid: 900 },
      { pid: 300, ppid: 200, pgid: 300 },
      { pid: 900, ppid: 1, pgid: 900 },
      { pid: 901, ppid: 900, pgid: 901 },
    ],
    expected: [300, 100],
  },
  {
    name: 'reparented members of both claimed groups and their children',
    rows: [
      { pid: 101, ppid: 1, pgid: 100 },
      { pid: 200, ppid: 101, pgid: 200 },
      { pid: 201, ppid: 1, pgid: 200 },
      { pid: 300, ppid: 201, pgid: 300 },
    ],
    expected: [200, 300, 100],
  },
  {
    name: 'our own group without following our own children',
    rows: [
      { pid: 100, ppid: 500, pgid: 100 },
      { pid: 400, ppid: 100, pgid: 400 },
      { pid: 500, ppid: 100, pgid: 400 },
      { pid: 600, ppid: 500, pgid: 600 },
    ],
    expected: [100],
  },
  {
    name: 'a cyclic table without revisiting processes',
    rows: [
      { pid: 100, ppid: 200, pgid: 100 },
      { pid: 200, ppid: 100, pgid: 200 },
    ],
    expected: [200, 100],
  },
  { name: 'an empty table with leaders retained', rows: [], expected: [100] },
];

describe('owned signal process groups', () => {
  it.each(WALKER_CASES)('finds $name', ({ rows, expected }) => {
    expect([...descendantGroups(rows, [100], 500)]).toEqual(expected);
  });

  it('protects unsafe leaders, this pid and this process group', () => {
    const rows = [{ pid: 500, ppid: 1, pgid: 400 }];
    expect(descendantGroups(rows, [0, 1, -2, 1.5, 400, 500, 100, 100], 500)).toEqual(
      new Set([100]),
    );
  });

  it('retains multiple leaders when no table is available', () => {
    expect(descendantGroups([], [100, 200], 500)).toEqual(new Set([100, 200]));
  });

  it('claims nothing without a tool leader', () => {
    const rows = [{ pid: 100, ppid: 500, pgid: 100 }];
    expect(descendantGroups(rows, [], 500)).toEqual(new Set());
  });

  it('passes the parsed table into the walker', () => {
    const rows = parseProcessRows('300 200 300\n200 100 200\n100 500 100\n500 1 400\n');
    expect(descendantGroups(rows, [100], 500)).toEqual(new Set([100, 200, 300]));
  });
});
