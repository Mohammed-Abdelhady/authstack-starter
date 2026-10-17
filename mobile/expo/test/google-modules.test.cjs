const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { withPlugins, withPodfileProperties } = require('expo/config-plugins');
const appConfig = require('../app.config');
const withGoogleModules = require('../plugins/with-google-modules');

const EXPECTED_PODS = [
  { name: 'GoogleUtilities', modular_headers: true },
  { name: 'RecaptchaInterop', modular_headers: true },
];

async function propertiesAfter(
  properties,
  config = withGoogleModules({ name: 'Test', slug: 'test' }),
) {
  const result = await config.mods.ios.podfileProperties({
    ...config,
    modResults: properties,
    modRequest: {},
  });
  return result.modResults;
}

function configuredWithHost(pods) {
  const host = (config) =>
    withPodfileProperties(config, (mod) => {
      mod.modResults = { ...mod.modResults, 'apple.extraPods': JSON.stringify(pods) };
      return mod;
    });
  const configured = appConfig({
    config: {
      name: 'Test',
      slug: 'test',
      plugins: [host],
      _internal: { projectRoot: path.resolve(__dirname, '..') },
    },
  });
  return withPlugins(configured, configured.plugins);
}

test('the real Expo plugin list merges a host writer before validating Google modules', async () => {
  const config = configuredWithHost([{ name: 'HostPod', version: '1.2' }]);
  const result = await propertiesAfter({ 'ios.deploymentTarget': '16.0' }, config);
  assert.deepEqual(JSON.parse(result['apple.extraPods']), [
    { name: 'HostPod', version: '1.2' },
    ...EXPECTED_PODS,
  ]);
  assert.equal(result['ios.deploymentTarget'], '16.0');
  for (const pods of [
    [{ name: 'GoogleUtilities', modular_headers: false }],
    [{ name: 'RecaptchaInterop' }, { name: 'RecaptchaInterop' }],
  ])
    await assert.rejects(propertiesAfter({}, configuredWithHost(pods)));
});

test('preserves host pods and options while merging and repeating the two required entries', async () => {
  const host = { name: 'HostPod', version: '1.2', configurations: ['Debug'] };
  const input = {
    'apple.extraPods': JSON.stringify([
      host,
      { name: 'GoogleUtilities', version: '8.0' },
      { name: 'RecaptchaInterop', modular_headers: true },
    ]),
    'host.setting': 'keep',
  };
  const once = await propertiesAfter(input);
  assert.deepEqual(JSON.parse(once['apple.extraPods']), [
    host,
    { name: 'GoogleUtilities', version: '8.0', modular_headers: true },
    EXPECTED_PODS[1],
  ]);
  assert.equal(once['host.setting'], 'keep');
  assert.deepEqual(await propertiesAfter(once), once);
  assert.equal(
    input['apple.extraPods'],
    JSON.stringify([
      host,
      { name: 'GoogleUtilities', version: '8.0' },
      { name: 'RecaptchaInterop', modular_headers: true },
    ]),
  );
});

test('refuses malformed or contradictory host configuration instead of overwriting it', async () => {
  for (const value of [
    'invalid',
    '{}',
    '[null]',
    '[{}]',
    '[{"name":"GoogleUtilities","modular_headers":false}]',
    '[{"name":"GoogleUtilities"},{"name":"GoogleUtilities"}]',
  ]) {
    await assert.rejects(propertiesAfter({ 'apple.extraPods': value }));
  }
});
