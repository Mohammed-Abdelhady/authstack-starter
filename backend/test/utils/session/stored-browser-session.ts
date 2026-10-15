import type { INestApplication } from '@nestjs/common';
import type { StoredSession } from '../../../src/session/authority/session-authority.store';
import { Sessions } from '../../../src/auth/services/sessions/sessions';

export function storedBrowserSession(
  app: INestApplication,
  cookie: string,
): Promise<StoredSession | null> {
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  return app.get(Sessions, { strict: false }).getSessionByToken(token);
}
