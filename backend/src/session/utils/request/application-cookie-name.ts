import type { BrowserApplicationId } from '../../applications/types/browser-application';
import { ADMIN_CLIENT_ID } from '../../constants/client-ids';

export const APPLICATION_COOKIE_PLACEHOLDER = '{application}';

export function applicationCookieName(
  base: string,
  clientId: BrowserApplicationId,
): string {
  if (base.includes(APPLICATION_COOKIE_PLACEHOLDER)) {
    return base.replace(APPLICATION_COOKIE_PLACEHOLDER, clientId);
  }
  return clientId === ADMIN_CLIENT_ID ? `${base}-${ADMIN_CLIENT_ID}` : base;
}
