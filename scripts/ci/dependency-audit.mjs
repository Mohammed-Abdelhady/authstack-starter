import { spawnSync } from 'node:child_process';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const MAX_AUDIT_BYTES = 8 * 1024 * 1024;

function vulnerabilityCounts(output) {
  const report = JSON.parse(output);
  if (!report || typeof report !== 'object' || report.error !== undefined) {
    throw new Error('Audit unavailable');
  }
  const counts = report.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') {
    throw new Error('Audit unavailable');
  }
  return SEVERITIES.map((severity) => {
    const count = counts[severity];
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Audit unavailable');
    }
    return `${severity}=${count}`;
  });
}

function runAudit() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--audit-level=high', '--json'], {
    encoding: 'utf8',
    maxBuffer: MAX_AUDIT_BYTES,
  });
  if (result.error || result.signal || result.status === null) {
    throw new Error('Audit unavailable');
  }
  const counts = vulnerabilityCounts(result.stdout);
  if (result.status === 0) {
    console.log('Dependency audit completed');
    return;
  }
  if (result.status !== 1) throw new Error('Audit unavailable');
  console.log(`::warning::Dependency audit findings: ${counts.join(' ')}`);
}

try {
  runAudit();
} catch {
  console.error('::error::Dependency audit unavailable');
  process.exitCode = 1;
}
