import { parseNativeApplications } from './native-application-config.util';

describe('existing native policy hash input', () => {
  it.each([
    '[{"clientId":"mobile","displayName":"Mobile","redirectUris":["https://app.example/callback"],"allowedScopes":["api"]}]',
    '[{"clientId":"mobile","displayName":"Mobile","redirectUris":["https://app.example/callback"],"allowedScopes":["api"],"signIn":{"password":true,"emailLink":false,"providers":[{"id":"google","mode":"system"}]}}]',
  ])('preserves the pre-reservation parsed JSON %s', (before) => {
    // These are the old parser's serialized results, also used by policyHash.
    const parsed = parseNativeApplications(before);
    const after = JSON.stringify(parsed);
    expect(after).toBe(before);
    expect(JSON.stringify(parseNativeApplications(after))).toBe(before);
  });
});
