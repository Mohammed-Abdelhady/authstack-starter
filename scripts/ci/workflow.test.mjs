import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectGates } from './runner.mjs';

const WORKFLOW = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const CONFIG = JSON.parse(readFileSync(new URL('./gates.json', import.meta.url), 'utf8'));
const GATE_MODE = /^\s+run: node scripts\/ci\.mjs (--(?!install$|cache$|range$)[\w-]+)$/;

/** Each job of the workflow: its time limit and the gate modes its steps run. */
function jobs(workflow) {
  const found = {};
  let current;
  let inJobs = false;
  for (const line of workflow.split('\n')) {
    if (/^\S/.test(line)) inJobs = line === 'jobs:';
    if (!inJobs) continue;
    const key = /^ {2}([\w-]+):$/.exec(line)?.[1];
    if (key) {
      current = found[key] = { minutes: undefined, modes: [] };
      continue;
    }
    const minutes = /^ {4}timeout-minutes: (\d+)$/.exec(line)?.[1];
    if (minutes) current.minutes = Number(minutes);
    const mode = GATE_MODE.exec(line)?.[1];
    if (mode) current.modes.push(mode);
  }
  return found;
}

test('every job has a time limit and runs the gate group written here', () => {
  const found = jobs(WORKFLOW);

  assert.deepEqual(
    Object.entries(found).map(([job, { modes }]) => [job, modes]),
    [
      ['range-scan', []],
      ['quality', ['--quality']],
      ['installer', ['--installer']],
      ['installer-postgres', ['--installer-postgres']],
      ['installer-mongodb', ['--installer-mongodb']],
    ],
  );
  assert.deepEqual(
    Object.entries(found).filter(([, { minutes }]) => !Number.isInteger(minutes)),
    [],
  );
});

test('every gate of the local list runs in exactly one job, and every job mode has gates', () => {
  const modes = Object.values(jobs(WORKFLOW)).flatMap((job) => job.modes);
  const ran = modes.flatMap((mode) => selectGates(CONFIG, mode).map((gate) => gate.name));

  assert.deepEqual(
    ran,
    selectGates(CONFIG).map((gate) => gate.name),
  );
});

test('a job is read with the limit it lacks and only the gate groups it runs', () => {
  const sample = [
    'jobs:',
    '  first:',
    '    steps:',
    '      - name: Run',
    '        run: node scripts/ci.mjs --quality',
    '      - name: Install',
    '        run: node scripts/ci.mjs --install',
    'other:',
    '  ignored:',
  ].join('\n');

  assert.deepEqual(jobs(sample), { first: { minutes: undefined, modes: ['--quality'] } });
});
