import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SessionCookieService } from '../../auth/services/sessions/session-cookie.service';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { browserApplicationsForTest } from '../testing/browser-applications.harness-spec';
import { createRequestMock } from '../testing/test-doubles.harness-spec';

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
