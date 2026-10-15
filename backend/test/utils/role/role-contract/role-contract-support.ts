import { ConfigService } from '@nestjs/config';
import { AudiencePolicy } from '../../../../src/session/applications/audience-policy';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { RoleService } from '../../../../src/role/role.service';
import { RoleSweepBootstrapService } from '../../../../src/role/services/bootstrap/role-sweep-bootstrap.service';
import { RoleEditService } from '../../../../src/role/services/edit/role-edit.service';
import { RoleHierarchyService } from '../../../../src/role/services/role-hierarchy.service';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { RoleContractHarness } from './role-contract-harness';

export type RoleHarnessSource = () => RoleContractHarness;

export const ADMIN_SLUG = 'admin';
export const MANAGER_SLUG = 'manager';
export const DEFAULT_SLUG = 'user';
export const EDITOR_SLUG = 'content-editor';
export const LEAD_SLUG = 'content-lead';
export const CHIEF_SLUG = 'content-chief';
export const PEER_SLUG = 'regional-lead';

export const WILDCARD = '*';
export const READ_POSTS = 'posts:read:all';
export const DELETE_USERS = 'users:delete:all';
export const CREATE_ROLES = 'roles:create:all';
export const UPDATE_ROLES = 'roles:update:all';
export const DELETE_ROLES = 'roles:delete:all';

export const REVOKED_ALL = 'sessions_revoked_all';
export const ADMIN_FORCED = 'admin_forced';

export interface RoleServices {
  roles: RoleService;
  edit: RoleEditService;
  hierarchy: RoleHierarchyService;
  bootstrap: () => RoleSweepBootstrapService;
}

/** The real role services on this database's adapters and that runner. */
export function servicesOn(
  harness: RoleContractHarness,
  pause: RerunPause = rerunAtOnce,
  config: ConfigService = new ConfigService({}),
): RoleServices {
  const audiences = new AudiencePolicy(config);
  const runner = harness.runner(pause);
  const edit = new RoleEditService(
    runner,
    harness.changes,
    harness.sweeps,
    audiences,
  );
  return {
    roles: new RoleService(harness.catalog, edit),
    edit,
    hierarchy: new RoleHierarchyService(harness.catalog),
    bootstrap: () =>
      new RoleSweepBootstrapService(
        runner,
        harness.changes,
        harness.sweeps,
        harness.clock,
        audiences,
      ),
  };
}

export interface RoleFixture {
  adminId: string;
  managerId: string;
  editorRoleId: string;
}

/**
 * The roles every case starts from: an admin holding the wildcard, a manager at
 * level 3 who may manage roles and read posts, the default role, and a custom
 * role two of the cases' accounts hold.
 */
export async function seedRoleFixture(
  harness: RoleContractHarness,
): Promise<RoleFixture> {
  await harness.seedRole({
    name: 'Admin',
    slug: ADMIN_SLUG,
    level: 4,
    permissions: [WILDCARD],
    isSystemRole: true,
    isProtected: true,
  });
  await harness.seedRole({
    name: 'Manager',
    slug: MANAGER_SLUG,
    level: 3,
    permissions: [CREATE_ROLES, UPDATE_ROLES, DELETE_ROLES, READ_POSTS],
  });
  await harness.seedRole({
    name: 'User',
    slug: DEFAULT_SLUG,
    level: 1,
    permissions: [],
    isSystemRole: true,
    isProtected: true,
  });
  const editorRoleId = await harness.seedRole({
    name: 'Content Editor',
    slug: EDITOR_SLUG,
    permissions: [READ_POSTS],
  });
  return {
    adminId: await harness.seedAccount({ role: ADMIN_SLUG }),
    managerId: await harness.seedAccount({ role: MANAGER_SLUG }),
    editorRoleId,
  };
}

/** The code and status an application error carries, or the error's name. */
export function answerOf(error: unknown): { code: unknown; status: unknown } {
  if (!(error instanceof Error)) {
    return { code: 'not an error', status: undefined };
  }
  return {
    code: Reflect.get(error, 'code') ?? error.name,
    status: Reflect.get(error, 'status'),
  };
}

/** Stored facts of several accounts, in the order asked. */
export function accountsOf(
  harness: RoleContractHarness,
  userIds: string[],
): Promise<Array<{ role: string; sessionVersion: number } | null>> {
  return Promise.all(userIds.map((userId) => harness.account(userId)));
}

/** Who was signed out and by whom, sorted so storage order does not matter. */
export async function revocationsOf(
  harness: RoleContractHarness,
): Promise<string[]> {
  const events = await harness.events();
  return events
    .filter((event) => event.action === REVOKED_ALL)
    .map(
      (event) =>
        `${event.targetUserId ?? 'nobody'} by ${event.actorId ?? 'nobody'} (${event.reasonCode ?? 'no reason'})`,
    )
    .sort();
}
