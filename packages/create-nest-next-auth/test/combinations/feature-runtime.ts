import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BUILD_TIMEOUT, type CommandResult } from '../support/combination-helpers.js';

const require = createRequire(import.meta.url);
const REGISTER = require.resolve('ts-node/register');

const CHECK_FEATURES = `
  const assert = require('node:assert/strict');
  const { AuthFeaturesService } = require('./src/auth/services/features/auth-features.service');
  const { AuthFeature } = require('./src/auth/enums/auth-feature.enum');
  const selected = new Set(JSON.parse(process.argv[1]));
  const features = [
    [AuthFeature.PASSWORD, 'email-password'],
    [AuthFeature.MAGIC_LINK, 'magic-link'],
    [AuthFeature.TWO_FACTOR, 'totp'],
    [AuthFeature.PASSKEYS, 'passkeys'],
  ];
  for (const enabled of [true, false]) {
    const service = new AuthFeaturesService({ get: () => enabled });
    for (const [feature, id] of features) {
      const expected = enabled && selected.has(id);
      assert.equal(service.isEnabled(feature), expected, id);
      if (expected) service.assertEnabled(feature);
      else assert.throws(() => service.assertEnabled(feature), { status: 404 });
    }
  }
`;

/** A configured runtime flag must never restore a method the CLI removed. */
export function verifyFeatureAvailability(project: string, features: string[]): CommandResult {
  const result = spawnSync(
    process.execPath,
    ['-r', REGISTER, '-e', CHECK_FEATURES, JSON.stringify(features)],
    { cwd: join(project, 'backend'), encoding: 'utf8', timeout: BUILD_TIMEOUT },
  );
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
