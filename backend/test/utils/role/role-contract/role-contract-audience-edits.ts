import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { ROLE_AUDIENCE } from '../../../../src/host/types/host-role.type';
import { finishBootstrap } from '../../../../src/role/services/bootstrap/role-bootstrap.harness-spec';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  ADMIN_FORCED,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  LEAD_SLUG,
  RoleFixture,
  RoleHarnessSource,
  answerOf,
  revocationsOf,
  servicesOn,
} from './role-contract-support';

const ACTIVE = () =>
  new ConfigService({
    auth: { web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } } },
  });

/** Every holder loses stale authority, including legacy audience mismatches. */
export function roleAudienceEditCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  it.each([
    ['permission edit', { permissions: [] }],
    ['level edit', { level: 2 }],
    ['rename', { name: 'Content Lead' }],
    ['rename and permission edit', { name: 'Content Lead', permissions: [] }],
  ])(
    'revokes every holder once for a %s without crossing audiences',
    async (_, edit) => {
      const h = harness();
      await h.alterRoleAudience(EDITOR_SLUG, ROLE_AUDIENCE.STAFF);
      const staff = await h.seedAccount({
        role: EDITOR_SLUG,
        audience: ROLE_AUDIENCE.STAFF,
      });
      const customer = await h.seedAccount({
        role: EDITOR_SLUG,
        audience: ROLE_AUDIENCE.CUSTOMER,
      });
      const legacy = await h.seedAccount({ role: EDITOR_SLUG });
      const bystander = await h.seedAccount({ role: DEFAULT_SLUG });
      const services = servicesOn(h, undefined, ACTIVE());
      const renamed = 'name' in edit;

      const answer = await services.roles.update(
        EDITOR_SLUG,
        edit,
        fixture().adminId,
      );
      await finishBootstrap([services.bootstrap()]);
      await finishBootstrap([services.bootstrap()]);

      expect(answer.usersMoved).toBe(renamed ? 1 : 0);
      expect(
        await Promise.all(
          [staff, customer, legacy, bystander].map((id) => h.account(id)),
        ),
      ).toEqual([
        {
          role: renamed ? LEAD_SLUG : EDITOR_SLUG,
          sessionVersion: 1,
          audience: ROLE_AUDIENCE.STAFF,
        },
        {
          role: EDITOR_SLUG,
          sessionVersion: 1,
          audience: ROLE_AUDIENCE.CUSTOMER,
        },
        { role: EDITOR_SLUG, sessionVersion: 1 },
        { role: DEFAULT_SLUG, sessionVersion: 0 },
      ]);
      expect(
        (await h.role(renamed ? LEAD_SLUG : EDITOR_SLUG))?.owedRepairs,
      ).toEqual(
        renamed ? [`${EDITOR_SLUG} for ${fixture().editorRoleId}`] : [],
      );
      expect(await revocationsOf(h)).toEqual(
        [
          `${staff} by ${fixture().adminId} (${ADMIN_FORCED})`,
          `${customer} by ${fixture().adminId} (${ADMIN_FORCED})`,
          `${legacy} by ${fixture().adminId} (${ADMIN_FORCED})`,
        ].sort(),
      );
    },
  );

  // The new session-only bump must share the role write and event transaction.
  it.each([
    ['permission edit', { permissions: [] }],
    ['rename and permission edit', { name: 'Content Lead', permissions: [] }],
  ])(
    'rolls back a mismatched-holder %s when its events fail',
    async (_, edit) => {
      const h = harness();
      await h.alterRoleAudience(EDITOR_SLUG, ROLE_AUDIENCE.STAFF);
      const customer = await h.seedAccount({
        role: EDITOR_SLUG,
        audience: ROLE_AUDIENCE.CUSTOMER,
      });
      const legacy = await h.seedAccount({ role: EDITOR_SLUG });
      const before = await h.role(EDITOR_SLUG);
      const allowEvents = await h.refuseSecurityEvents();
      let failure: unknown;
      try {
        failure = await rejectionOf(
          servicesOn(h, undefined, ACTIVE()).roles.update(
            EDITOR_SLUG,
            edit,
            fixture().adminId,
          ),
        );
      } finally {
        allowEvents();
      }

      expect(answerOf(failure)).toEqual({
        code: ErrorCode.ROLE_NAME_TAKEN,
        status: 409,
      });
      expect(await h.role(EDITOR_SLUG)).toEqual(before);
      expect(await h.role(LEAD_SLUG)).toBeNull();
      expect(await h.account(customer)).toEqual({
        role: EDITOR_SLUG,
        sessionVersion: 0,
        audience: ROLE_AUDIENCE.CUSTOMER,
      });
      expect(await h.account(legacy)).toEqual({
        role: EDITOR_SLUG,
        sessionVersion: 0,
      });
      expect(await h.events()).toEqual([]);
    },
  );
}
