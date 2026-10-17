import {
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
} from '../../session/constants/client-ids';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import {
  createRequestMock,
  createResponseMock,
} from '../../common/testing/test-doubles.harness-spec';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { OAuthStateService } from './oauth-state.service';
import {
  OAUTH_STATE_COOKIE_PREFIX,
  OAUTH_STATE_TTL_MS,
} from './oauth.constants';

const SECRET = 'unit-test-oauth-state-secret-value-32';
const HOST_WEB_GITHUB_COOKIE = `__Host-${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_github`;
const HOST_WEB_APPLE_COOKIE = `__Host-${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_apple`;
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

describe('OAuth state cookie name', () => {
  it('writes a host-only cookie in production: prefixed name, path /, secure', () => {
    expect(written(serviceIn('production'), 'github', LOGIN)).toMatchObject({
      name: HOST_WEB_GITHUB_COOKIE,
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
      name: HOST_WEB_APPLE_COOKIE,
      options: { secure: true, sameSite: 'none', path: '/' },
    });
  });

  it('keeps the plain name on the callback path outside production', () => {
    expect(written(serviceIn('development'), 'github', LOGIN)).toMatchObject({
      name: WEB_GITHUB_COOKIE,
      options: { secure: false, sameSite: 'lax', path: '/api/auth/oauth' },
    });
  });

  it('reads the production cookie under the prefixed name only', () => {
    const state = serviceIn('production');
    const { value } = written(state, 'github', LOGIN);

    expect({
      prefixed: codeOf(() =>
        state.readForStart(
          requestWith({ [HOST_WEB_GITHUB_COOKIE]: value }),
          'github',
        ),
      ),
      // What another host of the domain could plant: the unprefixed name.
      plain: codeOf(() =>
        state.readForStart(
          requestWith({ [WEB_GITHUB_COOKIE]: value }),
          'github',
        ),
      ),
    }).toEqual({ prefixed: 'accepted', plain: ErrorCode.OAUTH_STATE_INVALID });
  });

  it('clears the production cookie under the name and attributes it wrote', () => {
    const clearCookie = jest.fn();

    const state = serviceIn('production');
    const payload = state.create(LOGIN).payload;
    state.write(createResponseMock({ cookie: jest.fn() }), 'github', payload);
    state.clear(createResponseMock({ clearCookie }), 'github', payload);

    expect(clearCookie.mock.calls).toEqual([
      [
        HOST_WEB_GITHUB_COOKIE,
        { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ],
    ]);
  });
});

const NOW = 4_070_908_800_000;
const LEGACY_TTL_MS = 1000;
const WEB_BASE = 'https://web.example.test';
const ADMIN_BASE = 'https://admin.example.test';

/** Failure: one application's callback consumes the other application's ceremony. */
describe('application-bound OAuth state selection', () => {
  let state: OAuthStateService;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    state = new OAuthStateService(
      new ConfigService({
        NODE_ENV: 'production',
        oauth: { stateSecret: SECRET },
        cors: { clientUrl: WEB_BASE, adminUrl: ADMIN_BASE },
      }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  function issue(clientId: BrowserApplicationId) {
    const payload = state.create({ ...LOGIN, clientId }).payload;
    const cookie = jest.fn();
    state.write(createResponseMock({ cookie }), 'github', payload);
    const [name, value] = cookie.mock.calls[0] as [string, string];
    return { payload, name, value };
  }

  function signed(value: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    const signature = createHmac('sha256', SECRET)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${signature}`;
  }

  it('selects each echoed state and clears only its cookie', () => {
    const web = issue(WEB_CLIENT_ID);
    const admin = issue(ADMIN_CLIENT_ID);
    const request = requestWith({
      [web.name]: web.value,
      [admin.name]: admin.value,
    });
    expect(state.readForStart(request, 'github').clientId).toBe(WEB_CLIENT_ID);
    const selected = state.readCallback(request, 'github', admin.payload.state);
    expect({
      clientId: selected.clientId,
      returnBase: selected.returnBase,
    }).toEqual({ clientId: ADMIN_CLIENT_ID, returnBase: ADMIN_BASE });
    const clearCookie = jest.fn();
    state.clear(createResponseMock({ clearCookie }), 'github', selected);
    expect(clearCookie.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      admin.name,
    ]);
    expect(
      state.readCallback(request, 'github', web.payload.state).clientId,
    ).toBe(WEB_CLIENT_ID);
  });

  it('keeps a valid callback independent of another corrupt cookie', () => {
    const admin = issue(ADMIN_CLIENT_ID);
    const selected = state.readCallback(
      requestWith({
        [state.cookieName('github')]: 'corrupt',
        [admin.name]: admin.value,
      }),
      'github',
      admin.payload.state,
    );
    expect(selected.clientId).toBe(ADMIN_CLIENT_ID);
  });

  it('refuses missing or mismatching callback state and clears nothing without a selected payload', () => {
    const web = issue(WEB_CLIENT_ID);
    const request = requestWith({ [web.name]: web.value });
    expect(codeOf(() => state.readCallback(request, 'github', undefined))).toBe(
      ErrorCode.OAUTH_STATE_INVALID,
    );
    expect(codeOf(() => state.readCallback(request, 'github', 'wrong'))).toBe(
      ErrorCode.OAUTH_STATE_INVALID,
    );
    const clearCookie = jest.fn();
    state.clear(createResponseMock({ clearCookie }), 'github');
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it('accepts genuinely old signed state as web until its original expiry', () => {
    const value = signed({
      state: 'old-state',
      redirect: '/dashboard',
      expiresAt: NOW + LEGACY_TTL_MS,
      intent: 'login',
    });
    const request = requestWith({ [state.legacyCookieName('github')]: value });
    const selected = state.readCallback(request, 'github', 'old-state');
    expect({
      clientId: selected.clientId,
      returnBase: selected.returnBase,
    }).toEqual({ clientId: WEB_CLIENT_ID, returnBase: WEB_BASE });
    const clearCookie = jest.fn();
    state.clear(createResponseMock({ clearCookie }), 'github', selected);
    expect(clearCookie.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '__Host-oauth_github',
    ]);
    jest.spyOn(Date, 'now').mockReturnValue(NOW + LEGACY_TTL_MS);
    expect(
      codeOf(() => state.readCallback(request, 'github', 'old-state')),
    ).toBe(ErrorCode.OAUTH_STATE_INVALID);
  });

  it('rejects a signed application or return-base mismatch and modern state under the legacy name', () => {
    const admin = issue(ADMIN_CLIENT_ID);
    for (const cookies of [
      { [state.cookieName('github')]: admin.value },
      { [admin.name]: signed({ ...admin.payload, returnBase: WEB_BASE }) },
      { [state.legacyCookieName('github')]: admin.value },
    ]) {
      expect(
        codeOf(() =>
          state.readCallback(
            requestWith(cookies),
            'github',
            admin.payload.state,
          ),
        ),
      ).toBe(ErrorCode.OAUTH_STATE_INVALID);
    }
  });
});
