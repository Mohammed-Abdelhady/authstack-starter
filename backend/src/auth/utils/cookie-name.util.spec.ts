import { resolveSessionCookieName } from '../services/sessions/session-cookie.service';
import { hostCookieName } from './cookie-name.util';

describe('hostCookieName', () => {
  it('puts the host prefix on the name in production', () => {
    expect(hostCookieName('production', 'oauth_github')).toBe(
      '__Host-oauth_github',
    );
  });

  it.each(['development', 'test', 'Production', '', undefined])(
    'keeps the plain name when the environment is %p',
    (nodeEnv) => {
      expect(hostCookieName(nodeEnv, 'oauth_github')).toBe('oauth_github');
    },
  );

  it('names the session cookie through the same rule', () => {
    expect([
      resolveSessionCookieName('production', undefined),
      resolveSessionCookieName('development', undefined),
      resolveSessionCookieName('production', 'custom-session-id'),
    ]).toEqual(['__Host-sid', 'sid', 'custom-session-id']);
  });
});
