import { audienceMappingPlan } from '../../src/cli/utils/audience-mapping-plan';
import type { RoleAudience } from '../../src/host/types/host-role.type';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import { AudienceMappingStore } from '../../src/user/stores/audience-mapping.store';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { reconcileStartupApplications } from '../../src/session/session.module';
import type { BrowserApplicationId } from '../../src/session/applications/types/browser-application';
import type { BrowserEvidence } from '../../src/session/types/browser-evidence';
import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import { SEED_ADMIN } from '../constants/seed-users';
import { E2E_CLIENT_URL, type E2eApp } from './e2e-app';
import { setConfigValue } from './config-settings';

export const ADMIN_ORIGIN = 'http://127.0.0.1:3108';
export const SCOPE_ACTOR_ROLE = 'audience-scope-actor';
export const STAFF_TARGET_ROLE = 'audience-staff-target';
export const SCOPE_SEARCH = 'audience-scope-target';

export interface AudienceFixture {
  actorId: string;
  adminId: string;
  staffId: string;
  customerId: string;
}

/** Seed explicit mappings before activating settings on either database. */
export async function arrangeAudiences(
  e2e: E2eApp,
  permissions: string[] = ['users:list:all', 'users:read:all'],
  options: { actorAudience?: RoleAudience; staffApplication?: boolean } = {},
): Promise<AudienceFixture> {
  const config = e2e.app.get(ConfigService);
  setConfigValue(config, 'auth.web.signIn', undefined);
  setConfigValue(config, 'auth.admin.signIn', undefined);
  await e2e.reset();
  const runner = e2e.app.get(UnitOfWorkRunner);
  const roles = e2e.app.get(RoleChangeStore);
  await runner.run(async (work) => {
    await roles.insertCustomRole(work, {
      name: 'Scope Actor',
      slug: SCOPE_ACTOR_ROLE,
      level: 3,
      permissions,
      audience: options.actorAudience ?? ROLE_AUDIENCE.STAFF,
    });
    await roles.insertCustomRole(work, {
      name: 'Staff Target',
      slug: STAFF_TARGET_ROLE,
      level: 1,
      permissions: [],
      audience: ROLE_AUDIENCE.STAFF,
    });
  });
  const actor = await e2e.state.accounts.createAccount({
    email: 'scope-actor@example.test',
    name: 'Scope Actor',
    role: SCOPE_ACTOR_ROLE,
    isVerified: true,
  });
  const staff = await e2e.state.accounts.createAccount({
    email: 'audience-scope-target-staff@example.test',
    name: SCOPE_SEARCH,
    role: STAFF_TARGET_ROLE,
    isVerified: true,
  });
  const customer = await e2e.state.accounts.createAccount({
    email: 'audience-scope-target-customer@example.test',
    name: SCOPE_SEARCH,
    role: 'user',
    isVerified: true,
  });
  const mappings = e2e.app.get(AudienceMappingStore);
  await runner.run(async (work) => {
    const plan = audienceMappingPlan(
      await mappings.snapshot(work, { lock: true }),
      new Map(),
    );
    for (const { role, audience } of plan.roles) {
      await mappings.mapRole(work, role, audience);
    }
    for (const { account, audience } of plan.accounts) {
      await mappings.mapAccount(work, account, audience);
    }
  });
  if (options.staffApplication === false) {
    setConfigValue(config, 'auth.web.signIn', {
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
  } else {
    setConfigValue(config, 'auth.admin.signIn', {
      audience: ROLE_AUDIENCE.STAFF,
      signUp: 'closed',
    });
  }
  await reconcileStartupApplications(e2e.app);
  const adminId = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
  if (!adminId) throw new Error('fixture admin is missing');
  return {
    actorId: actor._id,
    adminId,
    staffId: staff._id,
    customerId: customer._id,
  };
}

export function issueAudienceBrowser(
  e2e: E2eApp,
  userId: string,
  clientId: BrowserApplicationId = ADMIN_CLIENT_ID,
  evidence: BrowserEvidence = {
    authenticationMethods: ['password'],
    userVerified: false,
  },
): Promise<IssuedBrowserSession> {
  return e2e.app
    .get(Sessions)
    .createSession(
      userId,
      'AudienceFixture/1',
      '127.0.0.1',
      clientId,
      evidence,
    );
}

export function audienceRequest(
  e2e: E2eApp,
  issued: IssuedBrowserSession,
  path: string,
  method: 'get' | 'post' | 'patch' | 'delete' = 'get',
  clientId: BrowserApplicationId = ADMIN_CLIENT_ID,
) {
  const cookieName = e2e.app.get(SessionCookieService).nameFor(clientId);
  return request(e2e.httpServer)
    [method](path)
    .set('Origin', clientId === ADMIN_CLIENT_ID ? ADMIN_ORIGIN : E2E_CLIENT_URL)
    .set('Cookie', `${cookieName}=${issued.sessionToken}`)
    .set(CSRF_HEADER, issued.csrfToken);
}
