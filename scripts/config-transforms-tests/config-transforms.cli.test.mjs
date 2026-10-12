import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  execFile,
  fitsInAddress,
  resolveOptionalDomain,
  writeFile as writeOwnedFile,
} from '../lib/cli-utils.js';
import { createSetupSecrets, generateBackendEnv } from '../lib/init-environment.js';

test('execFile does not interpret shell metacharacters in arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'execfile-'));
  try {
    const pwned = join(directory, 'pwned');
    const result = execFile(process.execPath, ['-e', 'process.exit(0)', `; touch ${pwned}`], {
      silent: true,
      cwd: directory,
    });
    assert.equal(result.success, true, result.error);
    assert.equal(existsSync(pwned), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid optional domains fall back to the supplied default', () => {
  assert.equal(resolveOptionalDomain('www.example.test', 'www.fallback.test'), 'www.example.test');
  assert.equal(
    resolveOptionalDomain('not a domain; rm -rf', 'www.fallback.test'),
    'www.fallback.test',
  );
  assert.equal(resolveOptionalDomain('', 'www.fallback.test'), 'www.fallback.test');
});

test('owned env files are written mode 0600 even when they already exist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'env-mode-'));
  try {
    const path = join(directory, '.env');
    writeOwnedFile(path, 'FIRST=1\n', { mode: 0o644 });
    writeOwnedFile(path, 'SECOND=2\n', { mode: 0o600 });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('init writes OAuth and native DPoP secrets into backend configuration', async () => {
  const source = await readFile(new URL('../init.js', import.meta.url), 'utf8');
  const randomSizes = [];
  const secrets = createSetupSecrets((size) => {
    randomSizes.push(size);
    return Buffer.from(String.fromCharCode(64 + randomSizes.length).repeat(size));
  });
  const backendEnv = generateBackendEnv(
    {
      appTitle: 'Test Application',
      env: { backendPort: 5001, frontendPort: 3000, mongoUri: 'mongodb://localhost/test' },
      smtp: { host: '', port: '587', secure: 'false', user: '', pass: '', from: '' },
      oauth: {
        google: { clientId: '', clientSecret: '' },
        facebook: { clientId: '', clientSecret: '' },
        github: { clientId: '', clientSecret: '' },
      },
      ...secrets,
    },
    'AUTH_NATIVE_APPLICATIONS=[]\n', // feature:native-core
  );

  assert.deepEqual(randomSizes, [
    48,
    48,
    48, // feature:passkeys
  ]);
  assert.equal(
    secrets.stateSecret,
    'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB',
  );
  assert.equal(
    secrets.nativeDpopNonceSecret,
    'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJC',
  );
  assert.notEqual(secrets.stateSecret, secrets.nativeDpopNonceSecret);
  // feature:passkeys:start
  assert.equal(secrets.passkeyChallengeSecret, 'Q0ND'.repeat(16));
  assert.notEqual(secrets.passkeyChallengeSecret, secrets.stateSecret);
  assert.notEqual(secrets.passkeyChallengeSecret, secrets.nativeDpopNonceSecret);
  // feature:passkeys:end

  assert.match(backendEnv, /OAUTH_CALLBACK_BASE_URL=http:\/\/localhost:5001\/api\/auth\/oauth/);
  assert.ok(
    backendEnv.includes(
      'OAUTH_STATE_SECRET=QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB',
    ),
  );
  // feature:native-core:start
  assert.ok(
    backendEnv.includes(
      'AUTH_NATIVE_DPOP_NONCE_SECRET=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJC',
    ),
  );
  assert.match(backendEnv, /AUTH_NATIVE_ENABLED=false/);
  assert.match(backendEnv, /AUTH_NATIVE_DPOP_REQUIRED=false/);
  // feature:native-core:end
  assert.match(source, /\.\.\.createSetupSecrets\(\)/);
  assert.match(source, /mode: 0o600/);
  assert.doesNotMatch(backendEnv, /frontendPort\}\/auth\/oauth\/callback/);
});

const INIT_CONFIG = {
  appTitle: 'Test Application',
  env: { backendPort: 5001, frontendPort: 3000, mongoUri: 'mongodb://localhost/test' },
  smtp: { host: '', port: '587', secure: 'false', user: '', pass: '', from: '' },
  oauth: {
    google: { clientId: '', clientSecret: '' },
    facebook: { clientId: '', clientSecret: '' },
    github: { clientId: '', clientSecret: '' },
  },
  stateSecret: 'fixed-oauth-secret',
  nativeDpopNonceSecret: 'fixed-native-secret',
};

// feature:native-core:start
const NATIVE_APPLICATIONS_LINE = /^AUTH_NATIVE_APPLICATIONS=/;
const REGISTRATION =
  'AUTH_NATIVE_APPLICATIONS=\'[ {"clientId":"custom.$client", "redirectUris":["custom://auth/callback"], "name":"A\\\\B"} ]\'  ';

test('init carries the example registration exactly and leaves native sign-in off', () => {
  const content = generateBackendEnv(
    INIT_CONFIG,
    `${REGISTRATION}\r\nAUTH_NATIVE_ENABLED=true\r\n`,
  );
  assert.equal(
    content.split('\n').find((line) => NATIVE_APPLICATIONS_LINE.test(line)),
    REGISTRATION,
  );
  assert.match(content, /^AUTH_NATIVE_ENABLED=false$/m);
});
// feature:native-core:end

for (const example of ['', '# AUTH_NATIVE_APPLICATIONS=example\n', 'PORT=5001\n']) {
  test(`init omits mobile configuration without active registration: ${JSON.stringify(example)}`, () => {
    assert.doesNotMatch(generateBackendEnv(INIT_CONFIG, example), /^AUTH_NATIVE_/m);
  });
}

test('init backs up then replaces an existing backend environment from the example', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const directory = await mkdtemp(join(tmpdir(), 'init-registration-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    const { writeBackendEnvironment } = await import('../lib/init-environment.js');
    await mkdir(join(directory, 'backend'));
    const envPath = join(directory, 'backend', '.env');
    await writeFile(envPath, 'EXISTING=keep-in-backup\n');
    await writeFile(join(directory, 'backend', '.env.example'), 'PORT=5001\n');
    const backup = writeBackendEnvironment(INIT_CONFIG, directory);
    assert.equal(backup, `${envPath}.backup.1970-01-01T00-00-00-000Z`);
    assert.equal(await readFile(backup, 'utf8'), 'EXISTING=keep-in-backup\n');
    const content = await readFile(envPath, 'utf8');
    assert.doesNotMatch(content, /^EXISTING=/m);
    assert.doesNotMatch(content, /^AUTH_NATIVE_/m);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
    // feature:native-core:start
    await writeFile(join(directory, 'backend', '.env.example'), `${REGISTRATION}\n`);
    writeBackendEnvironment(INIT_CONFIG, directory);
    assert.equal(
      (await readFile(envPath, 'utf8'))
        .split('\n')
        .find((line) => NATIVE_APPLICATIONS_LINE.test(line)),
      REGISTRATION,
    );
    // feature:native-core:end
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('init creates a private backend environment without an example or existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'init-no-example-'));
  try {
    const { writeBackendEnvironment } = await import('../lib/init-environment.js');
    assert.equal(writeBackendEnvironment(INIT_CONFIG, directory), null);
    const envPath = join(directory, 'backend', '.env');
    const content = await readFile(envPath, 'utf8');
    assert.match(content, /^PORT=5001$/m);
    assert.doesNotMatch(content, /^AUTH_NATIVE_/m);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a database user or password that would break the address is refused, one character at a time', () => {
  const refused = ['p@ss', 'p/ss', 'p#ss', 'p%ss', 'p:ss', 'p?ss', 'p ss', 'p\tss'];
  // Read as another setting in the unquoted env file line.
  const interpolated = ['pa$word', 'pa${word}', '$', 'tail$'];

  assert.deepEqual(
    refused.filter((value) => fitsInAddress(value)),
    [],
  );
  assert.deepEqual(
    interpolated.filter((value) => fitsInAddress(value)),
    [],
  );
  // The env file line loses the quotes around a value and the address line keeps them.
  const quoted = ['"secret"', "'secret'", '"secret\'', '""', "'", '"'];
  assert.deepEqual(
    quoted.filter((value) => fitsInAddress(value)),
    [],
  );
  assert.deepEqual(
    ['admin', 'safe-Password_1.~!&*+,;=', '', "it's", 'say"so', 'end"', "'start"].map((value) =>
      fitsInAddress(value),
    ),
    [true, true, true, true, true, true, true],
  );
});
