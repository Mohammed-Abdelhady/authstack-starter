import { ConfigService } from '@nestjs/config';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import { AudienceMappingStore } from '../../src/user/stores/audience-mapping.store';
import { AudienceMappingAudit } from '../../src/user/services/audience-mapping-audit';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { runAudienceApplyCommand } from '../utils/audience-apply-command';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('audience mapping operator command', () => {
  let e2e: E2eApp;
  const config = () => e2e.app.get(ConfigService);
  const runner = () => e2e.app.get(UnitOfWorkRunner);
  const snapshot = () =>
    runner().run((work) => e2e.app.get(AudienceMappingStore).snapshot(work));
  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    config().set('auth.web.signIn', undefined);
    await e2e.reset();
  });
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // Failure: a dry run changes authority or the real command leaves administrator sessions alive.
  it('keeps dry run read-only, maps existing data, revokes sessions and reruns without changes', async () => {
    const adminId = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
    if (!adminId) throw new Error('Expected fixture admin');
    const sessions = e2e.app.get(Sessions);
    const issued = await sessions.createSession(
      adminId,
      'CLI fixture',
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    const before = await snapshot();
    const dryRun = await runAudienceApplyCommand(config(), ['--dry-run']);
    expect(dryRun.code).toBe(0);
    expect(dryRun.summary).toEqual({
      dryRun: true,
      roles: 2,
      accounts: 4,
      revokedSessions: 0,
    });
    expect(await snapshot()).toEqual(before);
    expect(
      await sessions.validateSessionWithoutExtendingIdle(issued.sessionToken),
    ).not.toBeNull();
    const applied = await runAudienceApplyCommand(config());
    expect(applied.code).toBe(0);
    expect(applied.summary).toEqual({
      dryRun: false,
      roles: 2,
      accounts: 4,
      revokedSessions: 1,
    });
    const after = await snapshot();
    expect(after.roles.find(({ slug }) => slug === 'admin')?.audience).toBe(
      'staff',
    );
    expect(after.accounts.find(({ id }) => id === adminId)?.audience).toBe(
      'staff',
    );
    expect(
      await sessions.validateSessionWithoutExtendingIdle(issued.sessionToken),
    ).toBeNull();
    const repeated = await runAudienceApplyCommand(config());
    expect(repeated.code).toBe(0);
    expect(repeated.summary).toEqual({
      dryRun: false,
      roles: 0,
      accounts: 0,
      revokedSessions: 0,
    });
    expect(await snapshot()).toEqual(after);
  });

  // Failure: an omitted custom mapping is discovered only after core rows were changed.
  it('refuses missing custom mappings before writes, then accepts their explicit audience', async () => {
    await runner().run((work) =>
      e2e.app.get(RoleChangeStore).insertCustomRole(work, {
        name: 'Editors',
        slug: 'editors',
        level: 2,
        permissions: ['profile:read:own'],
      }),
    );
    const account = await e2e.state.accounts.createAccount({
      email: 'editor@example.test',
      name: 'Editor',
      role: 'editors',
      isVerified: true,
    });
    const before = await snapshot();
    const refused = await runAudienceApplyCommand(config());
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/Missing custom role audiences: editors/);
    expect(await snapshot()).toEqual(before);
    const applied = await runAudienceApplyCommand(config(), [
      '--role',
      'editors=customer',
    ]);
    expect(applied.code).toBe(0);
    const after = await snapshot();
    expect(after.roles.find(({ slug }) => slug === 'editors')?.audience).toBe(
      'customer',
    );
    expect(after.accounts.find(({ id }) => id === account._id)?.audience).toBe(
      'customer',
    );
    const conflict = await runAudienceApplyCommand(config(), [
      '--role',
      'editors=staff',
    ]);
    expect(conflict.code).toBe(1);
    expect(await snapshot()).toEqual(after);
  });

  // Failure: malformed, duplicate or conflicting mappings alter immutable audience data.
  it.each([
    ['--role', 'admin=customer'],
    ['--role', 'missing=staff'],
    ['--role', 'admin=unknown'],
    ['--role', 'admin=staff', '--role', 'admin=staff'],
  ])(
    'refuses invalid mappings before any changes: %p',
    async (...args: string[]) => {
      const before = await snapshot();
      expect((await runAudienceApplyCommand(config(), args)).code).toBe(1);
      expect(await snapshot()).toEqual(before);
    },
  );

  // Failure: mapping preserves grants that let a customer bypass staff-only authority.
  it.each(['account', 'role'] as const)(
    'refuses customer %s staff grants without stripping permissions or mapping data',
    async (source) => {
      if (source === 'account') {
        const account = await e2e.state.accounts.accountIdFor(SEED_USER.email);
        if (!account) throw new Error('Expected fixture customer');
        await e2e.state.records.replaceAccountPermissions(account, [
          'users:read:staff',
        ]);
      } else {
        await runner().run((work) =>
          e2e.app.get(RoleChangeStore).insertCustomRole(work, {
            name: 'Editors',
            slug: 'editors',
            level: 2,
            audience: 'customer',
            permissions: ['*'],
          }),
        );
      }
      const before = await snapshot();
      const refused = await runAudienceApplyCommand(config());
      expect(refused.code).toBe(1);
      expect(refused.stderr).toMatch(
        /Customer (?:account|role).*staff permissions/,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  // Failure: audience settings serve traffic while legacy accounts or roles remain unmapped.
  it('keeps dormant startup unchanged, then refuses named audiences with counts and repair', async () => {
    await expect(
      reconcileStartupApplications(e2e.app),
    ).resolves.toBeUndefined();
    config().set('auth.web.signIn', { audience: 'customer' });
    await expect(reconcileStartupApplications(e2e.app)).rejects.toThrow(
      /4 accounts and 2 roles.*audience:apply/,
    );
    expect((await runAudienceApplyCommand(config())).code).toBe(0);
    await expect(
      e2e.app.get(AudienceMappingAudit).assertMapped(),
    ).resolves.toBeUndefined();
    await expect(
      reconcileStartupApplications(e2e.app),
    ).resolves.toBeUndefined();
  });
});
