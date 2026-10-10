import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

const FIXTURES = __dirname;
const BACKEND = join(FIXTURES, '..', '..', '..');
const JEST_CLI = join(
  dirname(require.resolve('jest/package.json')),
  'bin',
  'jest.js',
);

const CONFIG = {
  rootDir: BACKEND,
  roots: [FIXTURES],
  testRegex: '\\.fixture-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  testEnvironment: 'node',
};

export interface FixtureCase {
  suite: string;
  title: string;
  status: string;
}

export interface FixtureRun {
  /** Null while the process has not ended by itself. */
  exitCode: number | null;
  cases: FixtureCase[];
}

export interface StartedFixtureRun {
  finished: Promise<FixtureRun>;
  /** Ends a run that did not end by itself. A no-op once it has. */
  kill(): void;
}

function readReport(output: string): Omit<FixtureRun, 'exitCode'> {
  const report: unknown = JSON.parse(output);
  const suites: unknown = Reflect.get(Object(report), 'testResults');
  const cases: FixtureCase[] = [];
  for (const suite of Array.isArray(suites) ? suites : []) {
    const results: unknown = Reflect.get(Object(suite), 'assertionResults');
    for (const result of Array.isArray(results) ? results : []) {
      const ancestors: unknown = Reflect.get(Object(result), 'ancestorTitles');
      cases.push({
        suite: String(Array.isArray(ancestors) ? ancestors[0] : ''),
        title: String(Reflect.get(Object(result), 'title')),
        status: String(Reflect.get(Object(result), 'status')),
      });
    }
  }
  return { cases };
}

/**
 * Runs the fixture suites in one process of their own, one after the other. Nothing here ends that process: `finished`
 * resolves only when it exits by itself.
 */
export function startFixtureSuites(): StartedFixtureRun {
  const child = spawn(
    process.execPath,
    [JEST_CLI, '--config', JSON.stringify(CONFIG), '--runInBand', '--json'],
    { cwd: BACKEND, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let complaints = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    complaints += chunk.toString('utf8');
  });
  const finished = new Promise<FixtureRun>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => {
      try {
        resolve({ exitCode, ...readReport(output) });
      } catch {
        reject(new Error(`The fixture run reported nothing: ${complaints}`));
      }
    });
  });
  return {
    finished,
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    },
  };
}
