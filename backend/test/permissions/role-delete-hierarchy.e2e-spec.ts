import { ConfigService } from '@nestjs/config';
import { ROLE_PERMISSIONS } from '../../src/common/constants/permissions';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { RoleEditService } from '../../src/role/services/edit/role-edit.service';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import type { StoredRole } from '../../src/role/stores/role-records';
import { RoleSweepStore } from '../../src/role/stores/role-sweep.store';
import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import {
  ADMIN_ORIGIN,
  SCOPE_ACTOR_ROLE,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { holdBefore, RaceGate } from '../utils/race-gate';

const ACTOR_LEVEL = 3;
const LOWER_LEVEL = 2;
const HIGHER_LEVEL = 4;
const TARGET_SLUG = 'delete-hierarchy-target';
const DEMOTED_SLUG = 'delete-hierarchy-demoted';
const DELETE_GRANTS = [ROLE_PERMISSIONS.DELETE_ALL];
const AUTHORITY_CHANGES = ['level', 'permission', 'assignment'] as const;
type AuthorityChange = (typeof AUTHORITY_CHANGES)[number];

let e2e: E2eApp;
let actorId: string;
let browser: IssuedBrowserSession;
let changes: RoleChangeStore;
let runner: UnitOfWorkRunner;
const gates: RaceGate[] = [];
const restores: Array<() => void> = [];

function insertTarget(level: number): Promise<StoredRole> {
  return runner.run((work) =>
    changes.insertCustomRole(work, {
      name: 'Deletion Target',
      slug: TARGET_SLUG,
      level,
      audience: ROLE_AUDIENCE.STAFF,
      permissions: [],
    }),
  );
}

function versionOf(role: StoredRole): number {
  if (role.version === undefined)
    throw new Error('fixture role has no observed version');
  return role.version;
}

function deleting(role: StoredRole) {
  return audienceRequest(e2e, browser, `/api/roles/${role.id}`, 'delete').query(
    { version: versionOf(role) },
  );
}

async function persisted(role: StoredRole) {
  return runner.run(async (work) => {
    const fallback = await changes.readRoleBySlug(work, 'user');
    if (!fallback) throw new Error('fixture default role is missing');
    return {
      role: await changes.readRole(work, role.id),
      deletion: await e2e.app
        .get(RoleSweepStore)
        .readDeletionRecord(work, role.id),
      defaultRepairs: fallback.pendingHolderSweeps,
    };
  });
}

async function expectRefused(role: StoredRole) {
  const response = await deleting(role).expect(403);
  expect(response.body).toMatchObject({
    error: { code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE },
  });
  expect(await persisted(role)).toEqual({
    role,
    deletion: null,
    defaultRepairs: [],
  });
}

async function changeAuthority(kind: AuthorityChange) {
  if (kind === 'assignment') {
    await runner.run((work) =>
      changes.insertCustomRole(work, {
        name: 'Demoted Actor',
        slug: DEMOTED_SLUG,
        level: LOWER_LEVEL,
        audience: ROLE_AUDIENCE.STAFF,
        permissions: DELETE_GRANTS,
      }),
    );
    await e2e.state.records.changeAccountRole(actorId, DEMOTED_SLUG);
    return;
  }
  await runner.run(async (work) => {
    const actor = await changes.readRoleAuthorityBySlug(work, SCOPE_ACTOR_ROLE);
    if (!actor) throw new Error('fixture actor role is missing');
    await changes.takeRoleForChange(work, actor.id);
    await changes.saveRoleEdit(
      work,
      actor.id,
      kind === 'level' ? { level: LOWER_LEVEL } : { permissions: [] },
    );
  });
}

function boundaryCases() {
  it.each([ACTOR_LEVEL, HIGHER_LEVEL])(
    'refuses deletion at target level %i without deleting or recording repairs',
    async (level) => {
      const target = await insertTarget(level);
      await expectRefused(target);
    },
  );

  it('deletes an unheld lower role using the observed version', async () => {
    const target = await insertTarget(LOWER_LEVEL);

    await deleting(target).expect(204);

    expect((await persisted(target)).role).toBeNull();
  });

  it('preserves the existing wildcard exception for a higher custom role', async () => {
    const fixture = await arrangeAudiences(e2e, ['*']);
    browser = await issueAudienceBrowser(e2e, fixture.actorId);
    const target = await insertTarget(HIGHER_LEVEL);

    await deleting(target).expect(204);

    expect((await persisted(target)).role).toBeNull();
  });
}

function admittedAuthorityCases() {
  it.each(AUTHORITY_CHANGES)(
    'rereads actor %s after HTTP admission before committing deletion',
    async (kind) => {
      const target = await insertTarget(LOWER_LEVEL);
      const gate = new RaceGate();
      gates.push(gate);
      restores.push(
        holdBefore(e2e.app.get(RoleEditService), 'delete', () => gate),
      );
      const pending = deleting(target).then((response) => response);
      try {
        await gate.reached();
        await changeAuthority(kind);
      } finally {
        gate.release();
        await pending;
      }
      const response = await pending;

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE },
      });
      expect(await persisted(target)).toEqual({
        role: target,
        deletion: null,
        defaultRepairs: [],
      });
    },
  );
}

describe('role deletion hierarchy at the persisted write boundary', () => {
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('cors.adminUrl', ADMIN_ORIGIN);
        config.set('admin.strictMutations', true);
      },
    });
    changes = e2e.app.get(RoleChangeStore);
    runner = e2e.app.get(UnitOfWorkRunner);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    const fixture = await arrangeAudiences(e2e, DELETE_GRANTS);
    actorId = fixture.actorId;
    browser = await issueAudienceBrowser(e2e, actorId);
  });

  afterEach(() => {
    for (const gate of gates.splice(0)) gate.release();
    for (const restore of restores.splice(0)) restore();
  });

  boundaryCases();
  admittedAuthorityCases();
});
