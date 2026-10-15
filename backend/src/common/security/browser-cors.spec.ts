import { ConfigService } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';
import { SessionCookieService } from '../../auth/services/sessions/session-cookie.service';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { browserApplicationsForTest } from '../testing/browser-applications.harness-spec';
import { createRequestMock } from '../testing/test-doubles.harness-spec';
import { browserCorsDelegate } from './browser-cors';

const WEB_ORIGIN = 'http://web.test';
const ADMIN_ORIGIN = 'http://admin.test';

function setup(adminUrl?: string) {
  const reads: BrowserApplicationId[] = [];
  const stored = new Map<BrowserApplicationId, boolean>([
    [WEB_CLIENT_ID, true],
    [ADMIN_CLIENT_ID, true],
  ]);
  const config = new ConfigService({
    cors: { clientUrl: WEB_ORIGIN, ...(adminUrl ? { adminUrl } : {}) },
  });
  const applications = browserApplicationsForTest(config, (clientId) => {
    reads.push(clientId);
    return Promise.resolve(stored.get(clientId) ?? false);
  });
  const cookies = new SessionCookieService(config, applications);
  return { reads, stored, applications, cookies };
}

function corsFor(
  context: ReturnType<typeof setup>,
  request: Request,
): Promise<CorsOptions | undefined> {
  return new Promise((resolve, reject) => {
    browserCorsDelegate(context.applications)(request, (error, options) => {
      if (error) reject(error);
      else resolve(options);
    });
  });
}

function browserRequest(
  context: ReturnType<typeof setup>,
  origin?: string,
): Request {
  return createRequestMock({
    headers: origin ? { origin } : {},
    cookies: { [context.cookies.nameFor(WEB_CLIENT_ID)]: 'session-token' },
    path: '/api/user/profile',
  });
}

// Failure: every request, health checks included, waits on the store, and a
// signed-in browser request repeats the same read once per check.
describe('browser CORS and origin checks', () => {
  it('answers a request without Origin from configuration and reads nothing', async () => {
    const context = setup();

    const options = await corsFor(context, browserRequest(context));

    expect(options?.origin).toBe(WEB_ORIGIN);
    expect(context.reads).toEqual([]);
  });

  it('reads each stored application once for every check of one request', async () => {
    const context = setup(ADMIN_ORIGIN);
    const request = browserRequest(context, WEB_ORIGIN);

    await corsFor(context, request);
    await context.cookies.assertOrigin(request);
    await context.cookies.assertOrigin(request);
    const resolved = await context.applications.resolve(request);

    expect(resolved).toMatchObject({ clientId: WEB_CLIENT_ID, enabled: true });
    expect([...context.reads].sort()).toEqual([ADMIN_CLIENT_ID, WEB_CLIENT_ID]);
  });

  it('reads again for the next request and refuses an origin stored as disabled', async () => {
    const context = setup(ADMIN_ORIGIN);
    await context.cookies.assertOrigin(browserRequest(context, WEB_ORIGIN));
    context.stored.set(WEB_CLIENT_ID, false);

    await expect(
      context.cookies.assertOrigin(browserRequest(context, WEB_ORIGIN)),
    ).rejects.toMatchObject({ code: 'ORIGIN_REJECTED', status: 403 });
    expect(context.reads).toHaveLength(4);
  });
});
