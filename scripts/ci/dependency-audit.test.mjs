import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gitEnvironment as isolatedEnv } from '../guardrails/git/git-environment.mjs';

const ENTRY = fileURLToPath(new URL('./dependency-audit.mjs', import.meta.url));
const AUDIT_ARGUMENTS = ['audit', '--prod', '--audit-level=high', '--json'];
const PAYLOAD_MARKER = 'AUDIT_BOUNDARY_PRIVATE_PAYLOAD';
const CLEAN_REPORT = {
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
  detail: PAYLOAD_MARKER,
};
const FINDINGS_REPORT = {
  metadata: { vulnerabilities: { info: 1, low: 2, moderate: 3, high: 4, critical: 5 } },
  detail: PAYLOAD_MARKER,
};
const FAKE_PNPM = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const outcome = JSON.parse(readFileSync('outcome.json', 'utf8'));
writeFileSync('invocation.json', JSON.stringify(process.argv.slice(2)));
process.stdout.write(outcome.stdout);
process.stderr.write(outcome.stderr || '');
if (outcome.signal) process.kill(process.pid, 'SIGTERM');
else process.exitCode = outcome.status;
`;

function runAudit(t, outcome, availability = 'ready') {
  const root = mkdtempSync(join(tmpdir(), 'dependency-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync(process.execPath, join(root, 'node'));
  if (availability !== 'missing') {
    writeFileSync(join(root, 'pnpm'), FAKE_PNPM, {
      mode: availability === 'denied' ? 0o644 : 0o755,
    });
  }
  writeFileSync(join(root, 'outcome.json'), JSON.stringify(outcome));
  const result = spawnSync(process.execPath, [ENTRY], {
    cwd: root,
    env: isolatedEnv({ PATH: root, HOME: root, XDG_CONFIG_HOME: root }),
    encoding: 'utf8',
  });
  return { result, root };
}

function assertPrivateOutput(result) {
  assert.ok(!result.error, 'Audit entry itself must start');
  assert.equal(result.signal, null);
  assert.ok(
    !`${result.stdout}${result.stderr}`.includes(PAYLOAD_MARKER),
    'Audit payload must remain private',
  );
}

function assertUnavailable(result) {
  assertPrivateOutput(result);
  assert.equal(result.status, 1);
  assert.ok(result.stdout === '', 'Operational failure must not publish success');
  assert.ok(
    /^::error::[^\r\n]+\n$/.test(result.stderr),
    'Operational failure must publish one bounded error annotation',
  );
}

function assertInvocation(root) {
  const args = JSON.parse(readFileSync(join(root, 'invocation.json'), 'utf8'));
  assert.deepEqual(args, AUDIT_ARGUMENTS);
}

test('successful audit validates metadata and keeps the report private', (t) => {
  const { result, root } = runAudit(t, { status: 0, stdout: JSON.stringify(CLEAN_REPORT) });
  assertPrivateOutput(result);
  assert.equal(result.status, 0);
  assert.ok(result.stderr === '', 'Successful audit has no operational error');
  assert.ok(/^[^:\r\n][^\r\n]*\n$/.test(result.stdout), 'Publish one status line');
  assertInvocation(root);
});

const INVALID_REPORTS = [
  { name: 'malformed JSON', stdout: PAYLOAD_MARKER },
  { name: 'structured error', stdout: JSON.stringify({ ...CLEAN_REPORT, error: PAYLOAD_MARKER }) },
  { name: 'missing metadata', stdout: JSON.stringify({ detail: PAYLOAD_MARKER }) },
  { name: 'missing count', counts: { info: 0, low: 0, moderate: 0, high: 0 } },
  { name: 'negative count', counts: { info: 0, low: 0, moderate: 0, high: 0, critical: -1 } },
  { name: 'fractional count', counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0.5 } },
];

for (const sample of INVALID_REPORTS) {
  test(`exit zero cannot hide ${sample.name}`, (t) => {
    const stdout =
      sample.stdout ??
      JSON.stringify({
        metadata: { vulnerabilities: sample.counts },
        detail: PAYLOAD_MARKER,
      });
    const { result, root } = runAudit(t, { status: 0, stdout });
    assertUnavailable(result);
    assertInvocation(root);
  });
}

test('findings warn with validated counts without failing the operational gate', (t) => {
  const { result, root } = runAudit(t, { status: 1, stdout: JSON.stringify(FINDINGS_REPORT) });
  assertPrivateOutput(result);
  assert.equal(result.status, 0);
  assert.ok(result.stderr === '', 'Findings are not an operational failure');
  assert.ok(/^::warning::[^\r\n]+\n$/.test(result.stdout), 'Publish one warning annotation');
  assert.deepEqual(result.stdout.match(/\b(?:info|low|moderate|high|critical)=\d+/g), [
    'info=1',
    'low=2',
    'moderate=3',
    'high=4',
    'critical=5',
  ]);
  assertInvocation(root);
});

test('exit one with an error report is operational failure', (t) => {
  const { result } = runAudit(t, {
    status: 1,
    stdout: JSON.stringify({ ...CLEAN_REPORT, error: PAYLOAD_MARKER }),
    stderr: PAYLOAD_MARKER,
  });
  assertUnavailable(result);
});

test('exit two cannot be accepted as findings', (t) => {
  const { result } = runAudit(t, { status: 2, stdout: JSON.stringify(CLEAN_REPORT) });
  assertUnavailable(result);
});

for (const availability of ['missing', 'denied']) {
  test(`unavailable pnpm executable is refused: ${availability}`, (t) => {
    const { result } = runAudit(
      t,
      { status: 0, stdout: JSON.stringify(CLEAN_REPORT) },
      availability,
    );
    assertUnavailable(result);
  });
}

test('pnpm terminated by a signal is operational failure', (t) => {
  const { result } = runAudit(t, {
    signal: true,
    stdout: JSON.stringify(CLEAN_REPORT),
    stderr: PAYLOAD_MARKER,
  });
  assertUnavailable(result);
});

test('audit output over the existing capture bound fails without forwarding it', (t) => {
  const { result } = runAudit(t, {
    status: 0,
    stdout: PAYLOAD_MARKER + 'x'.repeat(9 * 1024 * 1024),
  });
  assertUnavailable(result);
});
