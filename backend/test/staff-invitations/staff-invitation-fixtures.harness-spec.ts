import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import type { E2eApp } from '../utils/e2e-app';
import { audienceRequest } from '../utils/audience-authorization.fixtures';

export const INVITATION_ROUTE = '/api/admin/invitations';

export async function proveStaffAct(
  e2e: E2eApp,
  session: IssuedBrowserSession,
): Promise<void> {
  await audienceRequest(e2e, session, '/api/auth/proof/code', 'post')
    .send({})
    .expect(200);
  const code = await e2e.mailedCode();
  await audienceRequest(e2e, session, '/api/auth/proof/code/verify', 'post')
    .send({ code })
    .expect(200);
}
