/**
 * The eight data masks and the score that picks between them. A lower score
 * means fewer patterns that confuse a reader, so the lowest wins.
 */

type MaskFunction = (row: number, col: number) => boolean;

export const MASK_FUNCTIONS: readonly MaskFunction[] = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

/** Sequence that a reader could mistake for part of a finder pattern. */
const FINDER_LOOKALIKE = [true, false, true, true, true, false, true];

const RUN_PENALTY = 3;
const BLOCK_PENALTY = 3;
const LOOKALIKE_PENALTY = 40;
const BALANCE_PENALTY = 10;

function runScore(line: readonly boolean[]): number {
  let score = 0;
  let runLength = 1;

  for (let i = 1; i < line.length; i++) {
    if (line[i] === line[i - 1]) {
      runLength++;
      continue;
    }
    if (runLength >= 5) {
      score += RUN_PENALTY + (runLength - 5);
    }
    runLength = 1;
  }

  return runLength >= 5 ? score + RUN_PENALTY + (runLength - 5) : score;
}

/** Counts the finder lookalike with its four light modules on either side. */
function lookalikeScore(line: readonly boolean[]): number {
  let score = 0;
  const extended = [
    ...Array.from({ length: 4 }, () => false),
    ...line,
    ...Array.from({ length: 4 }, () => false),
  ];

  for (let start = 4; start + FINDER_LOOKALIKE.length <= line.length + 4; start++) {
    const matches = FINDER_LOOKALIKE.every((dark, offset) => extended[start + offset] === dark);
    if (!matches) {
      continue;
    }
    const beforeIsLight = extended.slice(start - 4, start).every((dark) => !dark);
    const afterStart = start + FINDER_LOOKALIKE.length;
    const afterIsLight = extended.slice(afterStart, afterStart + 4).every((dark) => !dark);

    if (beforeIsLight) {
      score += LOOKALIKE_PENALTY;
    }
    if (afterIsLight) {
      score += LOOKALIKE_PENALTY;
    }
  }

  return score;
}

function column(modules: readonly boolean[][], index: number): boolean[] {
  return modules.map((row) => row[index]);
}

/** Same-colour 2x2 areas, which are hard for a reader to align on. */
function blockScore(modules: readonly boolean[][]): number {
  let score = 0;

  for (let row = 0; row + 1 < modules.length; row++) {
    for (let col = 0; col + 1 < modules.length; col++) {
      const first = modules[row][col];
      if (
        modules[row][col + 1] === first &&
        modules[row + 1][col] === first &&
        modules[row + 1][col + 1] === first
      ) {
        score += BLOCK_PENALTY;
      }
    }
  }

  return score;
}

/** How far the share of dark modules sits from half. */
function balanceScore(modules: readonly boolean[][]): number {
  const total = modules.length * modules.length;
  const dark = modules.reduce(
    (sum, row) => sum + row.reduce((rowSum, isDark) => rowSum + (isDark ? 1 : 0), 0),
    0,
  );
  const deviation = Math.abs((dark * 100) / total - 50);
  return Math.floor(deviation / 5) * BALANCE_PENALTY;
}

export function penalty(modules: readonly boolean[][]): number {
  let score = blockScore(modules) + balanceScore(modules);

  for (let i = 0; i < modules.length; i++) {
    const currentColumn = column(modules, i);
    score += runScore(modules[i]) + runScore(currentColumn);
    score += lookalikeScore(modules[i]) + lookalikeScore(currentColumn);
  }

  return score;
}
