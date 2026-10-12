import assert from 'node:assert/strict';
import test from 'node:test';
import { createSetupSecrets, generateBackendEnv } from '../lib/init-environment.js';

const CONFIG = {
  appTitle: 'Test Application',
  env: {
    backendPort: 5001,
    frontendPort: 3000,
    mongoUri: 'mongodb://localhost/test', // feature:mongodb
  },
  smtp: { host: '', port: '587', secure: 'false', user: '', pass: '', from: '' },
  oauth: {
    google: { clientId: '', clientSecret: '' },
    facebook: { clientId: '', clientSecret: '' },
    github: { clientId: '', clientSecret: '' },
  },
  stateSecret: 'fixed-oauth-secret',
};

// feature:passkeys:start
test('setup writes an independent challenge key when the example offers passkeys', () => {
  let request = 0;
  const secrets = createSetupSecrets((size) => Buffer.alloc(size, ++request));
  const result = generateBackendEnv({ ...CONFIG, ...secrets }, '# PASSKEY_CHALLENGE_SECRET=\n');
  const setting = result.split('\n').find((line) => line.startsWith('PASSKEY_CHALLENGE_SECRET='));
  assert.equal(setting, `PASSKEY_CHALLENGE_SECRET=${'AwMD'.repeat(16)}`);
  assert.notEqual(secrets.passkeyChallengeSecret, secrets.stateSecret);
  assert.notEqual(secrets.passkeyChallengeSecret, secrets.nativeDpopNonceSecret);
});

test('setup refuses to emit a missing key for an offered passkey setting', () => {
  assert.throws(
    () => generateBackendEnv(CONFIG, 'PASSKEY_CHALLENGE_SECRET=\n'),
    /Passkey challenge signing key is missing/,
  );
});
// feature:passkeys:end

test('setup omits challenge keys when the generated project does not offer passkeys', () => {
  const result = generateBackendEnv(CONFIG, 'PORT=5001\n');
  assert.doesNotMatch(result, /^PASSKEY_CHALLENGE_SECRET=/m);
  assert.doesNotMatch(result, /=undefined$/m);
});
