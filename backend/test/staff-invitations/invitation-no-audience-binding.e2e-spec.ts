import { ConfigService } from '@nestjs/config';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import type { StoredRole } from '../../src/role/stores/role-records';
import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import { SEED_ADMIN } from '../constants/seed-users';
import type { ApiBody } from '../types/e2e-responses';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import { setConfigValue } from '../utils/config-settings';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { INVITATION_ROUTE } from './staff-invitation-fixtures.harness-spec';

const CUSTOM_SLUG = 'unmapped-invitation-role';
const EMAIL = 'unmapped-invitation@example.test';
const KEY = 'unmapped-invitation';
let e2e: E2eApp;
let session: IssuedBrowserSession;
interface InvitationReply {
  id: string;
}

function noAudienceConfiguration(config: ConfigService) {
  setConfigValue(config, 'auth.web.signIn', undefined);
  setConfigValue(config, 'auth.admin.signIn', undefined);
  setConfigValue(config, 'auth.nativeEnabled', false);
  config.set('admin.strictMutations', true);
}

function lifecycle() {
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('cors.adminUrl', ADMIN_ORIGIN);
        noAudienceConfiguration(config);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    noAudienceConfiguration(e2e.app.get(ConfigService));
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    const id = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
    if (!id) throw new Error('Missing seeded administrator');
    session = await issueAudienceBrowser(e2e, id);
  });
}

async function role(kind: 'seeded' | 'custom'): Promise<StoredRole> {
  return e2e.app.get(UnitOfWorkRunner).run(async (work) => {
    const roles = e2e.app.get(RoleChangeStore);
    if (kind === 'custom')
      return roles.insertCustomRole(work, {
        name: 'Unmapped invitation role',
        slug: CUSTOM_SLUG,
        level: 1,
        permissions: [],
      });
    const found = await roles.readRoleBySlug(work, 'user');
    if (!found) throw new Error('Missing seeded user role');
    return found;
  });
}

function create(body: object) {
  return audienceRequest(e2e, session, INVITATION_ROUTE, 'post')
    .set('Idempotency-Key', KEY)
    .send(body);
}

async function invitationCount() {
  return (
    await e2e.app
      .get(InvitationStore)
      .list({ page: 1, limit: 20, now: e2e.clock.now() })
  ).total;
}

function supportedRoleCases() {
  it.each(['seeded', 'custom'] as const)(
    'binds absent audience for %s roles without inventing one',
    async (kind) => {
      const observed = await role(kind);
      expect(observed.audience).toBeUndefined();
      const body = {
        email: EMAIL,
        role: observed.slug,
        expectedRoleId: observed.id,
        expectedAudience: null,
      };
      const first = await create(body).expect(201);
      const saved = (first.body as ApiBody<InvitationReply>).data;
      const stored = await e2e.app.get(InvitationStore).findById(saved.id);
      expect(stored).toMatchObject({
        roleId: observed.id,
        roleSlug: observed.slug,
        email: EMAIL,
      });
      expect(stored?.audience).toBeUndefined();
      const replay = await create(body).expect(201);
      expect((replay.body as ApiBody<InvitationReply>).data).toEqual(
        (first.body as ApiBody<InvitationReply>).data,
      );
      await create({ ...body, expectedAudience: 'staff' }).expect(409);
      await create({ ...body, expectedRoleId: 'different-role' }).expect(409);
      await create({
        email: EMAIL,
        role: observed.slug,
        expectedRoleId: observed.id,
      }).expect(409);
      expect(await invitationCount()).toBe(1);
      expect((await e2e.captureMail()).length).toBe(1);
    },
  );
}

function missingObservationCases() {
  it('refuses omission but accepts an explicit absent observation with the uncommitted key', async () => {
    const observed = await role('seeded');
    const body = {
      email: EMAIL,
      role: observed.slug,
      expectedRoleId: observed.id,
    };
    await create(body).expect(400);
    expect(await invitationCount()).toBe(0);
    expect((await e2e.captureMail()).length).toBe(0);
    await create({ ...body, expectedAudience: 'customer' }).expect(409);
    expect(await invitationCount()).toBe(0);
    await create({ ...body, expectedAudience: null }).expect(201);
    expect(await invitationCount()).toBe(1);
    expect((await e2e.captureMail()).length).toBe(1);
  });
}

function enabledAudienceCases() {
  it('does not admit an unmapped role after audience policy is enabled', async () => {
    const fixture = await arrangeAudiences(e2e, ['*']);
    session = await issueAudienceBrowser(e2e, fixture.adminId);
    const observed = await role('custom');
    const refusal = await create({
      email: EMAIL,
      role: observed.slug,
      expectedRoleId: observed.id,
      expectedAudience: null,
    }).expect(403);
    expect(refusal.body).toMatchObject({
      error: { code: ErrorCode.FORBIDDEN },
    });
    expect(await invitationCount()).toBe(0);
    expect((await e2e.captureMail()).length).toBe(0);
  });
}

describe('strict invitation binding without application audiences', () => {
  lifecycle();
  supportedRoleCases();
  missingObservationCases();
  enabledAudienceCases();
});
