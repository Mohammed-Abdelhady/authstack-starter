import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { OAuthStateService, OAuthStatePayload } from './oauth-state.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  OAUTH_STATE_COOKIE_PREFIX,
  OAUTH_STATE_TTL_MS,
} from './oauth.constants';
import {
  createRequestMock,
  createResponseMock,
} from '../../common/testing/test-doubles.harness-spec';

const SECRET = 'unit-test-oauth-state-secret-value-32';
const HOST_WEB_GOOGLE_COOKIE = `__Host-${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_google`;
const HOST_WEB_APPLE_COOKIE = `__Host-${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_apple`;
const WEB_GITHUB_COOKIE = `${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_github`;
const WEB_APPLE_COOKIE = `${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_apple`;

function service(nodeEnv = 'test'): OAuthStateService {
  const config: Record<string, unknown> = {
    'oauth.stateSecret': SECRET,
    'oauth.callbackBaseUrl': 'http://localhost:5000/api/auth/oauth',
    NODE_ENV: nodeEnv,
  };

  // A real ConfigService reads internal config values before validated env
  // and process.env, so the values seeded here always win on every reachable
  // path.
  return new OAuthStateService(new ConfigService(config));
}

function responseSpy(): {
  response: Response;
  cookie: jest.Mock;
  clearCookie: jest.Mock;
} {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    response: createResponseMock({ cookie, clearCookie }),
    cookie,
    clearCookie,
  };
}

function requestWith(cookies: Record<string, string>): Request {
  return createRequestMock({ cookies });
}

function expectStateInvalid(run: () => void): AppException {
  try {
    run();
  } catch (error) {
    const exception = error as AppException;
    expect(exception).toBeInstanceOf(AppException);
    expect(exception.getCode()).toBe(ErrorCode.OAUTH_STATE_INVALID);
    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    return exception;
  }
  throw new Error('expected the call to throw');
}

describe('OAuthStateService', () => {
  describe('create', () => {
    it('issues state only when the provider has neither PKCE nor OIDC', () => {
      const { payload, codeChallenge } = service().create({
        redirect: '/dashboard',
        supportsPkce: false,
        usesOidc: false,
      });

      expect(payload.state).toHaveLength(43);
      expect(payload.codeVerifier).toBeUndefined();
      expect(payload.nonce).toBeUndefined();
      expect(codeChallenge).toBeUndefined();
      expect(payload.redirect).toBe('/dashboard');
      expect(payload.intent).toBe('login');
      expect(payload.linkUserId).toBeUndefined();
      expect(payload.expiresAt).toBeGreaterThan(Date.now());
      expect(payload.expiresAt).toBeLessThanOrEqual(
        Date.now() + OAUTH_STATE_TTL_MS,
      );
    });

    it('adds an S256 challenge and a nonce for PKCE OIDC providers', () => {
      const { payload, codeChallenge } = service().create({
        redirect: '/',
        supportsPkce: true,
        usesOidc: true,
      });

      expect(payload.codeVerifier).toBeDefined();
      expect(payload.nonce).toBeDefined();
      expect(codeChallenge).toBe(
        createHash('sha256')
          .update(payload.codeVerifier as string)
          .digest('base64url'),
      );
    });

    it('stores the session user when the intent is link', () => {
      const { payload } = service().create({
        redirect: '/settings',
        supportsPkce: false,
        usesOidc: false,
        intent: 'link',
        linkUserId: 'user-1',
      });

      expect(payload.intent).toBe('link');
      expect(payload.linkUserId).toBe('user-1');
    });
  });

  describe('cookie', () => {
    it('writes an httpOnly lax cookie scoped to the callback path', () => {
      const state = service();
      const { response, cookie } = responseSpy();
      const { payload } = state.create({
        redirect: '/',
        supportsPkce: false,
        usesOidc: false,
      });

      state.write(response, 'github', payload);

      expect(cookie).toHaveBeenCalledWith(
        WEB_GITHUB_COOKIE,
        expect.stringMatching(/^[\w-]+\.[\w-]+$/),
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/api/auth/oauth',
          maxAge: OAUTH_STATE_TTL_MS,
        },
      );
    });

    it('marks the cookie secure in production', () => {
      const state = service('production');
      const { response, cookie } = responseSpy();
      const { payload } = state.create({
        redirect: '/',
        supportsPkce: false,
        usesOidc: false,
      });

      state.write(response, 'google', payload);

      expect(cookie).toHaveBeenCalledWith(
        HOST_WEB_GOOGLE_COOKIE,
        expect.any(String),
        expect.objectContaining({ secure: true }),
      );
    });

    it('relaxes SameSite for a cross site callback in production', () => {
      const state = service('production');
      const { response, cookie } = responseSpy();
      const { payload } = state.create({
        redirect: '/',
        supportsPkce: false,
        usesOidc: true,
      });

      state.write(response, 'apple', payload, true);

      expect(cookie).toHaveBeenCalledWith(
        HOST_WEB_APPLE_COOKIE,
        expect.any(String),
        expect.objectContaining({ sameSite: 'none', secure: true }),
      );
    });

    it('keeps SameSite=Lax for a cross site callback outside production', () => {
      const state = service();
      const { response, cookie } = responseSpy();
      const { payload } = state.create({
        redirect: '/',
        supportsPkce: false,
        usesOidc: true,
      });

      state.write(response, 'apple', payload, true);

      expect(cookie).toHaveBeenCalledWith(
        WEB_APPLE_COOKIE,
        expect.any(String),
        expect.objectContaining({ sameSite: 'lax', secure: false }),
      );
    });

    it('clears with the same attributes it wrote', () => {
      const state = service();
      const { response, clearCookie } = responseSpy();

      const payload = state.create({
        redirect: '/',
        supportsPkce: false,
        usesOidc: false,
      }).payload;
      state.write(response, 'github', payload);
      state.clear(response, 'github', payload);

      expect(clearCookie).toHaveBeenCalledWith(WEB_GITHUB_COOKIE, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/auth/oauth',
      });
    });
  });

  describe('readForStart', () => {
    function issue(state: OAuthStateService): {
      value: string;
      payload: OAuthStatePayload;
    } {
      const { response, cookie } = responseSpy();
      const { payload } = state.create({
        redirect: '/dashboard',
        supportsPkce: true,
        usesOidc: false,
      });
      state.write(response, 'github', payload);
      return { value: cookie.mock.calls[0][1] as string, payload };
    }

    it('reads signed start context without an echoed callback state', () => {
      const state = service();
      const { value, payload } = issue(state);

      const parsed = state.readForStart(
        requestWith({ [WEB_GITHUB_COOKIE]: value }),
        'github',
      );

      expect(parsed.state).toBe(payload.state);
      expect(parsed.codeVerifier).toBe(payload.codeVerifier);
      expect(parsed.redirect).toBe('/dashboard');
    });

    it('rejects a missing cookie', () => {
      const state = service();

      const exception = expectStateInvalid(() =>
        state.readForStart(requestWith({}), 'github'),
      );
      expect(exception.getDetails()).toEqual({ provider: 'github' });
    });

    it('rejects a tampered signature', () => {
      const state = service();
      const { value } = issue(state);
      const [encoded] = value.split('.');

      expectStateInvalid(() =>
        state.readForStart(
          requestWith({ [WEB_GITHUB_COOKIE]: `${encoded}.notarealsignature` }),
          'github',
        ),
      );
    });

    it('rejects a payload edited after signing', () => {
      const state = service();
      const { value } = issue(state);
      const [, signature] = value.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          state: 'attacker',
          redirect: '/',
          expiresAt: Date.now() + 1000,
        }),
      ).toString('base64url');

      expectStateInvalid(() =>
        state.readForStart(
          requestWith({ [WEB_GITHUB_COOKIE]: `${forged}.${signature}` }),
          'github',
        ),
      );
    });

    it('rejects an expired cookie', () => {
      const state = service();
      const { value } = issue(state);

      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + OAUTH_STATE_TTL_MS + 1000);

      try {
        expectStateInvalid(() =>
          state.readForStart(
            requestWith({ [WEB_GITHUB_COOKIE]: value }),
            'github',
          ),
        );
      } finally {
        jest.spyOn(Date, 'now').mockRestore();
      }
    });
  });

  describe('assertStateMatches', () => {
    const payload: OAuthStatePayload = {
      state: 'expected-state-value',
      clientId: WEB_CLIENT_ID,
      returnBase: 'http://localhost:3000',
      redirect: '/',
      expiresAt: Date.now() + 1000,
      intent: 'login',
    };

    it('accepts the state it issued', () => {
      expect(() =>
        service().assertStateMatches(payload, 'expected-state-value', 'github'),
      ).not.toThrow();
    });

    it('rejects a different state', () => {
      expectStateInvalid(() =>
        service().assertStateMatches(payload, 'wrong', 'github'),
      );
    });

    it('rejects a missing state', () => {
      expectStateInvalid(() =>
        service().assertStateMatches(payload, undefined, 'github'),
      );
    });
  });
});
