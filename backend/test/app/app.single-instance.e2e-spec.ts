import request from 'supertest';
import { AuthGuard } from '../../src/auth/guards/auth.guard';
import { BrowserProofGuard } from '../../src/auth/guards/browser-proof.guard';
import { PendingRegistrationStore } from '../../src/auth/pending-codes/pending-registration.store';
import { RegistrationService } from '../../src/auth/services/registration/registration.service';
import { UserProfileService } from '../../src/user/services/user-profile.service';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

/**
 * The application holds each module once. A module registered a second time
 * builds every provider again: a second copy of each scheduled job and of each
 * global guard, and `app.get` hands out the copy that serves no request.
 */
describe('one instance of every module', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds each auth and user provider once', () => {
    const instances = (token: abstract new (...args: never[]) => object) =>
      e2e.app.get(token, { strict: false, each: true }).length;

    expect({
      registration: instances(RegistrationService),
      pendingRegistrationStore: instances(PendingRegistrationStore),
      authGuard: instances(AuthGuard),
      userProfile: instances(UserProfileService),
    }).toEqual({
      registration: 1,
      pendingRegistrationStore: 1,
      authGuard: 1,
      userProfile: 1,
    });
  });

  it('runs each global guard once for a request', async () => {
    const authGuard = jest.spyOn(AuthGuard.prototype, 'canActivate');
    const browserProof = jest.spyOn(BrowserProofGuard.prototype, 'canActivate');

    const response = await request(e2e.httpServer).get('/health');

    expect({
      status: response.status,
      authGuard: authGuard.mock.calls.length,
      browserProof: browserProof.mock.calls.length,
    }).toEqual({ status: 200, authGuard: 1, browserProof: 1 });
  });
});
