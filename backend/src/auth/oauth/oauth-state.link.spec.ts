import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { OAUTH_STATE_COOKIE_PREFIX } from './oauth.constants';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  createRequestMock,
  createResponseMock,
} from '../../common/testing/test-doubles.harness-spec';
import { OAuthStateService } from './oauth-state.service';

const SECRET = 'unit-test-oauth-state-secret-value-32';
const WEB_GITHUB_COOKIE = `${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_github`;

function serviceIn(nodeEnv: string): OAuthStateService {
  return new OAuthStateService(
    new ConfigService({
      'oauth.stateSecret': SECRET,
      'oauth.callbackBaseUrl': 'https://api.example.test/api/auth/oauth',
      NODE_ENV: nodeEnv,
    }),
  );
}

interface WrittenCookie {
  name: string;
  value: string;
  options: unknown;
}

/** Writes a state cookie and answers what the response was told to set. */
function written(
  state: OAuthStateService,
  provider: string,
  request: Parameters<OAuthStateService['create']>[0],
  crossSite = false,
): WrittenCookie {
  const cookie = jest.fn();
  const response: Response = createResponseMock({ cookie });
  state.write(response, provider, state.create(request).payload, crossSite);
  const [name, value, options] = cookie.mock.calls[0] as [
    string,
    string,
    unknown,
  ];
  return { name, value, options };
}

const LOGIN = { redirect: '/', supportsPkce: false, usesOidc: false };

function requestWith(cookies: Record<string, string>): Request {
  return createRequestMock({ cookies });
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
  return 'accepted';
}

describe('OAuth state for a link', () => {
  const LINK = { ...LOGIN, intent: 'link' as const };

  it('carries the account and the session that asked', () => {
    const state = serviceIn('test');
    const { value } = written(state, 'github', {
      ...LINK,
      linkUserId: 'user-1',
      linkSessionId: 'session-1',
    });

    expect(
      state.readForStart(requestWith({ [WEB_GITHUB_COOKIE]: value }), 'github'),
    ).toMatchObject({
      intent: 'link',
      linkUserId: 'user-1',
      linkSessionId: 'session-1',
    });
  });

  it.each([
    ['no session', { linkUserId: 'user-1' }],
    ['no account', { linkSessionId: 'session-1' }],
    ['an empty session', { linkUserId: 'user-1', linkSessionId: '' }],
  ])('refuses a link state with %s', (_, binding) => {
    const state = serviceIn('test');
    const { value } = written(state, 'github', { ...LINK, ...binding });

    expect(
      codeOf(() =>
        state.readForStart(
          requestWith({ [WEB_GITHUB_COOKIE]: value }),
          'github',
        ),
      ),
    ).toBe('OAUTH_STATE_INVALID');
  });

  it('does not let a sign-in state carry a link', () => {
    const state = serviceIn('test');
    const { value } = written(state, 'github', {
      ...LOGIN,
      linkUserId: 'user-1',
      linkSessionId: 'session-1',
    });

    expect(
      state.readForStart(requestWith({ [WEB_GITHUB_COOKIE]: value }), 'github'),
    ).toMatchObject({ intent: 'login' });
    expect(
      state.readForStart(requestWith({ [WEB_GITHUB_COOKIE]: value }), 'github')
        .linkUserId,
    ).toBeUndefined();
  });
});
