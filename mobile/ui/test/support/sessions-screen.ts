import type { Session } from '@app/sdk';
import { TEST_ID } from '../../src/constants';
import type { Locale } from '../../src/i18n';
import { LAPTOP, PHONE, TABLET } from './devices';
import { signedInAs } from './fake-engine';
import { ok, ROUTE, sessionList } from './fake-server';
import { byRole, byTestId, isShown, press, renderApp, textsOf, type App } from './render';

export const ROW = (id: string) => `${TEST_ID.SESSION_ROW}-${id}`;
export const REVOKE = (id: string) => `${TEST_ID.SESSION_REVOKE}-${id}`;
export const IDLE = { disabled: false, busy: false };

const ADA = signedInAs('ada');

/**
 * Opens the devices screen. The list request is left for the test to answer. The
 * profile is answered first: the store reads a list again only once nothing else
 * is still out.
 */
export async function opened(locale: Locale = 'en'): Promise<App> {
  const app = await renderApp(ADA, { locale });
  await app.step(() => app.server.answer(ROUTE.PROFILE, ok(ADA.profile)));
  await press(app.root, TEST_ID.ACCOUNT_SESSIONS_LINK);
  return app;
}

export async function listed(locale: Locale = 'en', sessions: Session[] = [PHONE, LAPTOP, TABLET]) {
  const app = await opened(locale);
  await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList(sessions)));
  return app;
}

export const rows = (app: App) =>
  ['phone', 'laptop', 'tablet'].filter((id) => isShown(app.root, ROW(id)));
export const alerts = (app: App) => byRole(app.root, 'alert').map(textsOf);
export const problem = (app: App) =>
  isShown(app.root, TEST_ID.SESSIONS_NOTICE)
    ? textsOf(byTestId(app.root, TEST_ID.SESSIONS_NOTICE))
    : undefined;
export const writes = (app: App) => app.server.sent().filter((route) => !route.startsWith('GET '));
