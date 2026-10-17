import { InvitationIssuer } from '../../src/auth/invitations/services/invitation-issuer';
import { RetryableAbortError } from '../../src/common/persistence/persistence-errors';
import { ConfigService } from '@nestjs/config';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import type { StoredRole } from '../../src/role/stores/role-records';
import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import type { ApiBody } from '../types/e2e-responses';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import { holdBefore, RaceGate } from '../utils/race-gate';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  INVITATION_ROUTE,
  proveStaffAct,
} from './staff-invitation-fixtures.harness-spec';

const TARGET_SLUG = 'binding-target';
const INVITEE_EMAIL = 'bound-invitation@example.test';
const OPERATION_KEY = 'bound-invitation';

interface InvitationReply {
  id: string;
}

let e2e: E2eApp;
let session: IssuedBrowserSession;
let target: StoredRole;
let actorId: string;

function lifecycle() {
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('admin.strictMutations', false);
    const fixture = await arrangeAudiences(e2e, ['*']);
    actorId = fixture.actorId;
    session = await issueAudienceBrowser(e2e, actorId);
    target = await e2e.app.get(UnitOfWorkRunner).run((work) =>
      e2e.app.get(RoleChangeStore).insertCustomRole(work, {
        name: 'Binding Target',
        slug: TARGET_SLUG,
        level: 1,
        permissions: [],
        audience: ROLE_AUDIENCE.STAFF,
      }),
    );
  });
}

function boundBody() {
  return {
    email: INVITEE_EMAIL,
    role: TARGET_SLUG,
    expectedRoleId: target.id,
    expectedAudience: ROLE_AUDIENCE.STAFF,
  };
}

function create(body: object) {
  return audienceRequest(e2e, session, INVITATION_ROUTE, 'post')
    .set('Idempotency-Key', OPERATION_KEY)
    .send(body);
}

async function strictMode() {
  e2e.app.get(ConfigService).set('admin.strictMutations', true);
  await proveStaffAct(e2e, session);
}

async function invitations() {
  return e2e.app
    .get(InvitationStore)
    .list({ page: 1, limit: 20, now: e2e.clock.now() });
}

async function replaceTarget() {
  return e2e.app.get(UnitOfWorkRunner).run(async (work) => {
    const roles = e2e.app.get(RoleChangeStore);
    await roles.removeRole(work, target.id);
    return roles.insertCustomRole(work, {
      name: 'Replacement',
      slug: TARGET_SLUG,
      level: 1,
      permissions: [],
      audience: ROLE_AUDIENCE.STAFF,
    });
  });
}

function racingBindingCases() {
  // Failure: an unfenced role snapshot is used after its slug is replaced before authority acquisition.
  it('rejects a role replaced while create is acquiring target authority', async () => {
    const gate = new RaceGate();
    const roles = e2e.app.get(RoleChangeStore);
    const restore = holdBefore(
      roles,
      'readRoleAuthorityBySlug',
      (_call, args) => (args[1] === TARGET_SLUG ? gate : undefined),
    );
    const pending = create(boundBody()).then((response) => response);
    try {
      await gate.reached();
      await replaceTarget();
      gate.release();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.CONFLICT },
      });
      expect((await invitations()).total).toBe(0);
      expect((await e2e.captureMail()).length).toBe(0);
    } finally {
      gate.release();
      restore();
      await pending;
    }
  });
}

function strictBindingCases() {
  // Failure: strict writes silently accept an unbound target or leave an unusable receipt.
  it('requires both bindings for a first strict write and rolls refusals back', async () => {
    await strictMode();
    const before = (await e2e.captureMail()).length;
    for (const partial of [
      {},
      { expectedRoleId: target.id },
      { expectedAudience: 'staff' },
    ]) {
      const refusal = await create({
        email: INVITEE_EMAIL,
        role: TARGET_SLUG,
        ...partial,
      }).expect(400);
      expect(refusal.body).toMatchObject({
        error: { code: ErrorCode.VALIDATION_ERROR },
      });
    }
    expect((await invitations()).total).toBe(0);
    expect((await e2e.captureMail()).length).toBe(before);
    const response = await create(boundBody()).expect(201);
    const saved = (response.body as ApiBody<InvitationReply>).data;
    expect(await e2e.app.get(InvitationStore).findById(saved.id)).toMatchObject(
      {
        roleId: target.id,
        roleSlug: TARGET_SLUG,
        audience: 'staff',
        email: INVITEE_EMAIL,
      },
    );
    expect((await invitations()).total).toBe(1);
    expect((await e2e.captureMail()).length).toBe(before + 1);
  });
}

function malformedBindingCases() {
  // Failure: malformed bindings pass validation and reserve an address or send mail.
  it.each([
    { expectedRoleId: null },
    { expectedRoleId: '' },
    { expectedRoleId: [] },
    { expectedAudience: 'unknown' },
    { expectedAudience: {} },
  ])(
    'refuses malformed bindings without a committed invitation: %j',
    async (invalid) => {
      await create({ ...boundBody(), ...invalid }).expect(400);
      expect((await invitations()).total).toBe(0);
      expect((await e2e.captureMail()).length).toBe(0);
    },
  );
}

function audienceBindingCases() {
  it('refuses an explicit absent-audience binding for a mapped staff role', async () => {
    await create({ ...boundBody(), expectedAudience: null }).expect(409);
    expect((await invitations()).total).toBe(0);
    expect((await e2e.captureMail()).length).toBe(0);
  });

  // Failure: the server ignores the caller's audience intent outside strict mode.
  it.each([false, true])(
    'enforces the audience binding with strict mode %s',
    async (strict) => {
      if (strict) await strictMode();
      const before = (await e2e.captureMail()).length;
      const refusal = await create({
        ...boundBody(),
        expectedAudience: 'customer',
      }).expect(409);
      expect(refusal.body).toMatchObject({
        error: { code: ErrorCode.CONFLICT },
      });
      expect((await invitations()).total).toBe(0);
      expect((await e2e.captureMail()).length).toBe(before);
    },
  );
}

function replacementBindingCases() {
  // Failure: deleting and recreating the slug redirects an invitation to another role ID.
  it('refuses slug replacement and accepts a fresh observation with the same uncommitted key', async () => {
    const original = boundBody();
    const replacement = await replaceTarget();
    await create(original).expect(409);
    expect((await invitations()).total).toBe(0);
    expect((await e2e.captureMail()).length).toBe(0);
    const response = await create({
      ...original,
      expectedRoleId: replacement.id,
    }).expect(201);
    const saved = (response.body as ApiBody<InvitationReply>).data;
    expect(await e2e.app.get(InvitationStore).findById(saved.id)).toMatchObject(
      { roleId: replacement.id },
    );
    expect((await e2e.captureMail()).length).toBe(1);
  });
}

function replayBindingCases() {
  // Failure: recovery consults a mutable role or sends another invitation after a lost response.
  it.each(['rename', 'delete'])(
    'replays the saved result after role %s without mailing again',
    async (change) => {
      await strictMode();
      const body = boundBody();
      const first = await create(body).expect(201);
      const saved = (first.body as ApiBody<InvitationReply>).data;
      const before = (await e2e.captureMail()).length;
      await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
        const roles = e2e.app.get(RoleChangeStore);
        if (change === 'delete') await roles.removeRole(work, target.id);
        else
          await roles.saveRoleEdit(work, target.id, {
            slug: 'renamed-binding-target',
          });
      });
      const replay = await create(body).expect(201);
      expect((replay.body as ApiBody<InvitationReply>).data).toEqual(
        (first.body as ApiBody<InvitationReply>).data,
      );
      await create({ ...body, expectedAudience: 'customer' }).expect(409);
      await create({ ...body, expectedRoleId: 'different-role' }).expect(409);
      expect((await invitations()).total).toBe(1);
      expect(
        await e2e.app.get(InvitationStore).findById(saved.id),
      ).toMatchObject({ roleId: target.id });
      expect((await e2e.captureMail()).length).toBe(before);
      await e2e.state.records.changeAccountRole(actorId, 'user');
      await create(body).expect(403);
      expect((await e2e.captureMail()).length).toBe(before);
    },
  );
}

function legacyBindingCases() {
  // Failure: a strict rollout prevents recovery of an already committed legacy write.
  it('reconciles a legacy receipt after strict rollout without allowing a new legacy write', async () => {
    const body = { email: INVITEE_EMAIL, role: TARGET_SLUG };
    const first = await create(body).expect(201);
    await strictMode();
    const before = (await e2e.captureMail()).length;
    const replay = await create(body).expect(201);
    expect((replay.body as ApiBody<InvitationReply>).data).toEqual(
      (first.body as ApiBody<InvitationReply>).data,
    );
    await audienceRequest(e2e, session, INVITATION_ROUTE, 'post')
      .set('Idempotency-Key', 'new-legacy-write')
      .send({ ...body, email: 'other@example.test' })
      .expect(400);
    expect((await invitations()).total).toBe(1);
    expect((await e2e.captureMail()).length).toBe(before);
  });
}

function heldAuthorityCases() {
  // Failure: target deletion commits while issuance still relies on the checked role.
  it('holds target authority through invitation commit', async () => {
    const gate = new RaceGate();
    const restore = holdBefore(
      e2e.app.get(InvitationIssuer),
      'issue',
      () => gate,
    );
    const pending = create(boundBody()).then((response) => response);
    try {
      await gate.reached();
      await expect(
        e2e.app.get(UnitOfWorkRunner).run(async (work) => {
          const roles = e2e.app.get(RoleChangeStore);
          await roles.takeRoleForChange(work, target.id);
          await roles.removeRole(work, target.id);
        }),
      ).rejects.toBeInstanceOf(RetryableAbortError);
      gate.release();
      const response = await pending;
      expect(response.status).toBe(201);
      const saved = (response.body as ApiBody<InvitationReply>).data;
      expect(
        await e2e.app.get(InvitationStore).findById(saved.id),
      ).toMatchObject({ roleId: target.id });
      expect((await e2e.captureMail()).length).toBe(1);
    } finally {
      gate.release();
      restore();
      await pending;
    }
  });
}

describe('invitation target write guarantees', () => {
  lifecycle();
  strictBindingCases();
  malformedBindingCases();
  audienceBindingCases();
  replacementBindingCases();
  replayBindingCases();
  legacyBindingCases();
  racingBindingCases();
  heldAuthorityCases();
});
