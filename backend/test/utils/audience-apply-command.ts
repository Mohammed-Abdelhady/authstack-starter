import { execFile } from 'node:child_process';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AudienceApplySummary } from '../../src/cli/types/audience-apply';

const AUDIENCE_COMMAND_TIMEOUT_MS = 30_000;

interface AudienceCommandResult {
  code: number | null;
  summary?: AudienceApplySummary;
  stderr: string;
}

/** The package script's real entry point, outside the checkout's environment files. */
export async function runAudienceApplyCommand(
  config: ConfigService,
  args: readonly string[] = [],
): Promise<AudienceCommandResult> {
  const cwd = await mkdtemp(join(tmpdir(), 'audience-command-'));
  const backend = resolve(__dirname, '../..');
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const setting of [
    'ADMIN_URL',
    'AUTH_WEB_ENABLED',
    'AUTH_WEB_SIGN_IN',
    'AUTH_ADMIN_SIGN_IN',
    'AUTH_NATIVE_APPLICATIONS',
  ]) {
    delete environment[setting];
  }
  Object.assign(environment, {
    NODE_ENV: 'test',
    CLIENT_URL: 'http://localhost:3000',
    OAUTH_STATE_SECRET: 'audience-command-fixture-secret-0000',
    AUTH_NATIVE_ENABLED: 'false',
    DATABASE_TYPE: config.get<string>('DATABASE_TYPE'),
    MONGO_URI: config.get<string>('MONGO_URI'), // feature:mongodb
    POSTGRES_URL: config.get<string>('POSTGRES_URL'), // feature:postgres
  });
  try {
    return await new Promise<AudienceCommandResult>((resolveResult, reject) => {
      execFile(
        process.execPath,
        [resolve(backend, 'dist/cli/audience-apply.js'), ...args],
        {
          cwd,
          env: environment,
          encoding: 'utf8',
          timeout: AUDIENCE_COMMAND_TIMEOUT_MS,
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') {
            reject(error instanceof Error ? error : new Error(error.message));
            return;
          }
          const line = stdout
            .trim()
            .split('\n')
            .find((value) => value.startsWith('{'));
          try {
            resolveResult({
              code: typeof error?.code === 'number' ? error.code : 0,
              ...(line
                ? { summary: JSON.parse(line) as AudienceApplySummary }
                : {}),
              stderr,
            });
          } catch (parseError) {
            reject(
              parseError instanceof Error
                ? parseError
                : new Error(String(parseError)),
            );
          }
        },
      );
    });
  } finally {
    await rmdir(cwd);
  }
}
