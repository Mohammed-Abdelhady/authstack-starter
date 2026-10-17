import type { RoleAudience } from '../../../host/types/host-role.type';
import { ROLE_AUDIENCE } from '../../../host/types/host-role.type';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import type { BrowserApplications } from '../../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';

export function invitationApplication(
  role: { slug: string; audience?: RoleAudience },
  applications: Pick<BrowserApplications, 'isConfigured'>,
): BrowserApplicationId {
  return (isAdminRole(role.slug) || role.audience === ROLE_AUDIENCE.STAFF) &&
    applications.isConfigured(ADMIN_CLIENT_ID)
    ? ADMIN_CLIENT_ID
    : WEB_CLIENT_ID;
}

export function invitationClientId(clientId: string): BrowserApplicationId {
  if (clientId === WEB_CLIENT_ID || clientId === ADMIN_CLIENT_ID)
    return clientId;
  throw new Error('Invitations require a browser application');
}
