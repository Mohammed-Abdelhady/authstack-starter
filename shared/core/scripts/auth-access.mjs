import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { syncHostAccess } from './auth-access/sync.mjs';

try {
  const args = process.argv.slice(2);
  const unknown = args.find((argument) => argument !== '--check');
  if (unknown || args.length > 1) throw new Error(`Unknown argument: ${unknown ?? args.join(' ')}`);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await syncHostAccess({ root, check: args.includes('--check') });
  process.stdout.write(
    `${result.changed ? 'Updated' : 'Current'} shared/core/src/host-access.ts\n`,
  );
} catch (error) {
  process.stderr.write(`auth:access: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
