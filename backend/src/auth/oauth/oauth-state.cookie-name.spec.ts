import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  createRequestMock,
  createResponseMock,
} from '../../common/testing/test-doubles.harness-spec';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { OAuthStateService } from './oauth-state.service';
import { OAUTH_STATE_TTL_MS } from './oauth.constants';

const SECRET = 'unit-test-oauth-state-secret-value-32';

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

describe('OAuth state cookie name', () => {
  it('writes a host-only cookie in production: prefixed name, path /, secure', () => {
    expect(written(serviceIn('production'), 'github', LOGIN)).toMatchObject({
      name: '__Host-oauth_github',
      options: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: OAUTH_STATE_TTL_MS,
      },
    });
  });

  it('keeps the host prefix on the cross site cookie of a form post provider', () => {
    expect(
      written(serviceIn('production'), 'apple', LOGIN, true),
    ).toMatchObject({
      name: '__Host-oauth_apple',
      options: { secure: true, sameSite: 'none', path: '/' },
    });
  });

  it('keeps the plain name on the callback path outside production', () => {
    expect(written(serviceIn('development'), 'github', LOGIN)).toMatchObject({
      name: 'oauth_github',
      options: { secure: false, sameSite: 'lax', path: '/api/auth/oauth' },
    });
  });

  it('reads the production cookie under the prefixed name only', () => {
    const state = serviceIn('production');
    const { value } = written(state, 'github', LOGIN);

    expect({
      prefixed: codeOf(() =>
        state.read(requestWith({ '__Host-oauth_github': value }), 'github'),
      ),
      // What another host of the domain could plant: the unprefixed name.
      plain: codeOf(() =>
        state.read(requestWith({ oauth_github: value }), 'github'),
      ),
    }).toEqual({ prefixed: 'accepted', plain: ErrorCode.OAUTH_STATE_INVALID });
  });

  it('clears the production cookie under the name and attributes it wrote', () => {
    const clearCookie = jest.fn();

    serviceIn('production').clear(
      createResponseMock({ clearCookie }),
      'github',
    );

    expect(clearCookie.mock.calls).toEqual([
      [
        '__Host-oauth_github',
        { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ],
    ]);
  });
});
