import { AdminInvitationsController } from './admin-invitations.controller';
import { AdminInvitationsService } from './admin-invitations.service';
import { AdminInvitationAccessService } from './admin-invitation-access.service';
// feature:passkeys:start
import { AdminPasskeyResetController } from '../passkey-reset/admin-passkey-reset.controller';
import { AdminPasskeyResetService } from '../passkey-reset/admin-passkey-reset.service';
// feature:passkeys:end

export const ADMIN_INVITATION_CONTROLLERS = [
  AdminInvitationsController,
  AdminPasskeyResetController, // feature:passkeys
];

export const ADMIN_INVITATION_PROVIDERS = [
  AdminInvitationsService,
  AdminInvitationAccessService,
  AdminPasskeyResetService, // feature:passkeys
];
