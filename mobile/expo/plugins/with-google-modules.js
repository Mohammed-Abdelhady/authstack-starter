const { withPodfileProperties } = require('expo/config-plugins');

const EXTRA_PODS = 'apple.extraPods';
const GOOGLE_PODS = ['GoogleUtilities', 'RecaptchaInterop'];
const INVALID_EXTRA_PODS = 'apple.extraPods must contain pod objects with a name';

function extraPods(value) {
  const pods = value === undefined ? [] : JSON.parse(value);
  if (!Array.isArray(pods)) throw new TypeError(INVALID_EXTRA_PODS);
  for (const pod of pods) {
    if (!pod || typeof pod !== 'object' || Array.isArray(pod) || typeof pod.name !== 'string') {
      throw new TypeError(INVALID_EXTRA_PODS);
    }
  }
  return pods;
}

function googlePod(pods, name) {
  const matching = pods.filter((pod) => pod.name === name);
  if (matching.length > 1) throw new TypeError(`Duplicate ${name} extraPods configuration`);
  const existing = matching[0];
  if (existing && existing.modular_headers !== undefined && existing.modular_headers !== true) {
    throw new TypeError(`${name} requires modular_headers: true`);
  }
  return { ...existing, name, modular_headers: true };
}

function googleModuleProperties(properties) {
  const pods = extraPods(properties[EXTRA_PODS]);
  const preserved = pods.filter((pod) => !GOOGLE_PODS.includes(pod.name));
  return {
    ...properties,
    [EXTRA_PODS]: JSON.stringify([
      ...preserved,
      ...GOOGLE_PODS.map((name) => googlePod(pods, name)),
    ]),
  };
}

function withGoogleModules(config) {
  return withPodfileProperties(config, (mod) => {
    mod.modResults = googleModuleProperties(mod.modResults);
    return mod;
  });
}

module.exports = withGoogleModules;
