import request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { UserProfileService } from '../../src/user/services/user-profile.service';
import { AppException } from '../../src/common/exceptions/app.exception';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { PersistenceUnavailableError } from '../../src/common/persistence/persistence-errors';
import { unwrapIdentityBody } from '@app/sdk';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import {
  createNativeApplication,
  issueNativeGrantFor,
} from '../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('public identity bootstrap (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { nativeEnabled: true });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await e2e.reset();
  });

  it('returns signed out without credentials and keeps the protected profile protected', async () => {
    const answer = await request(e2e.httpServer)
      .get('/api/auth/identity')
      .expect(200);
    expect(unwrapIdentityBody(answer.body)).toEqual({
      authenticated: false,
      user: null,
    });
    await request(e2e.httpServer).get('/api/user/profile').expect(401);
  });

  it('passes the current browser account through the shared SDK parser', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const answer = await browser.get('/api/auth/identity').expect(200);
    const identity = unwrapIdentityBody(answer.body);
    expect(identity.authenticated).toBe(true);
    if (identity.authenticated) {
      expect(identity.user.email).toBe(SEED_USER.email);
      expect(identity.user.isVerified).toBe(true);
    }
  });

  it('passes the current native bearer account through the shared SDK parser', async () => {
    await createNativeApplication(e2e);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);
    const answer = await request(e2e.httpServer)
      .get('/api/auth/identity')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);
    const identity = unwrapIdentityBody(answer.body);
    expect(identity.authenticated).toBe(true);
    if (identity.authenticated)
      expect(identity.user.email).toBe(SEED_USER.email);
  });

  it('clears a revoked browser cookie and returns signed out', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await browser.post('/api/auth/logout').expect(200);
    const answer = await browser.get('/api/auth/identity').expect(200);
    expect(unwrapIdentityBody(answer.body)).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it('clears an invalid browser cookie while returning signed out', async () => {
    const name = e2e.app.get(SessionCookieService, { strict: false }).name;
    const answer = await request(e2e.httpServer)
      .get('/api/auth/identity')
      .set('Cookie', `${name}=invalid`)
      .expect(200);
    expect(unwrapIdentityBody(answer.body)).toEqual({
      authenticated: false,
      user: null,
    });
    expect(answer.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${name}=;`)]),
    );
  });

  it('refuses malformed and invalid bearer credentials', async () => {
    for (const authorization of [
      'Basic invalid',
      'Bearer ',
      'Bearer invalid',
    ]) {
      const answer = await request(e2e.httpServer)
        .get('/api/auth/identity')
        .set('Authorization', authorization)
        .expect(401);
      expect(answer.body.error.code).toBe('SESSION_INVALID');
    }
  });

  it('refuses cookie and bearer credentials together', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const answer = await browser
      .get('/api/auth/identity')
      .set('Authorization', 'Bearer invalid')
      .expect(400);
    expect(answer.body.error.code).toBe('MIXED_CREDENTIALS');
  });

  it('refuses a bearer if its account disappears after session validation', async () => {
    await createNativeApplication(e2e);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);
    const profiles = e2e.app.get(UserProfileService, { strict: false });
    const read = jest
      .spyOn(profiles, 'getProfile')
      .mockRejectedValueOnce(
        new AppException(
          ErrorCode.USER_NOT_FOUND,
          'User not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    try {
      const answer = await request(e2e.httpServer)
        .get('/api/auth/identity')
        .set('Authorization', `Bearer ${grant.accessToken}`)
        .expect(401);
      expect(answer.body.error.code).toBe('SESSION_INVALID');
    } finally {
      read.mockRestore();
    }
  });

  it('reports a session storage outage instead of declaring the browser signed out', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const sessions = e2e.app.get(Sessions, { strict: false });
    const validate = jest
      .spyOn(sessions, 'validateBrowserSession')
      .mockRejectedValueOnce(new PersistenceUnavailableError());
    try {
      const answer = await browser.get('/api/auth/identity').expect(503);
      expect(answer.body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    } finally {
      validate.mockRestore();
    }
  });
});
