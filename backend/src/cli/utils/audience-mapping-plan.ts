import { HOST_ROLES } from '../../host/access';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../host/types/host-role.type';
import { permissionsRequireStaff } from '../../session/utils/authority/audience-permissions';
import { UserRole } from '../../user/enums/user-role.enum';
import type { AudienceMappingSnapshot } from '../../user/types/audience-mapping';
import type { AudienceMappingPlan } from '../types/audience-apply';

export function audienceMappingPlan(
  snapshot: AudienceMappingSnapshot,
  explicit: ReadonlyMap<string, RoleAudience>,
): AudienceMappingPlan {
  const definitions = new Map<string, RoleAudience>([
    [UserRole.USER, ROLE_AUDIENCE.CUSTOMER],
    [UserRole.ADMIN, ROLE_AUDIENCE.STAFF],
    ...HOST_ROLES.map(({ slug, audience }): [string, RoleAudience] => [
      slug,
      audience,
    ]),
  ]);
  const known = new Map(snapshot.roles.map((role) => [role.slug, role]));
  for (const [slug, audience] of explicit) {
    const role = known.get(slug);
    if (!role) throw new Error(`Unknown --role slug: ${slug}`);
    const defined = definitions.get(slug) ?? role.audience;
    if (defined && defined !== audience) {
      throw new Error(
        `Audience mapping conflicts with stored or defined role: ${slug}`,
      );
    }
  }
  const audiences = new Map<string, RoleAudience>();
  const missing: string[] = [];
  const plan: AudienceMappingPlan = { roles: [], accounts: [] };
  for (const role of snapshot.roles) {
    const defined = definitions.get(role.slug);
    if (role.audience && defined && role.audience !== defined) {
      throw new Error(
        `Stored role audience conflicts with its definition: ${role.slug}`,
      );
    }
    const audience = role.audience ?? defined ?? explicit.get(role.slug);
    if (!audience) {
      missing.push(role.slug);
      continue;
    }
    if (
      audience === ROLE_AUDIENCE.CUSTOMER &&
      permissionsRequireStaff(role.permissions)
    ) {
      throw new Error(
        `Customer role ${role.slug} retains staff permissions. Repair its grants explicitly before audience:apply.`,
      );
    }
    audiences.set(role.slug, audience);
    if (!role.audience) plan.roles.push({ role, audience });
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing custom role audiences: ${missing.sort().join(', ')}. Supply --role slug=customer|staff for each.`,
    );
  }
  for (const account of snapshot.accounts) {
    const audience = audiences.get(account.role);
    if (!audience) {
      throw new Error(
        `Account role has no stored mapping: ${account.role}. Restore or repair that role before audience:apply.`,
      );
    }
    if (account.audience && account.audience !== audience) {
      throw new Error(
        `Account audience conflicts with role: ${account.id} (${account.role}). Repair the assignment explicitly.`,
      );
    }
    if (
      audience === ROLE_AUDIENCE.CUSTOMER &&
      permissionsRequireStaff(account.permissions)
    ) {
      throw new Error(
        `Customer account ${account.id} retains staff permissions. Repair its direct grants explicitly before audience:apply.`,
      );
    }
    if (!account.audience) plan.accounts.push({ account, audience });
  }
  return plan;
}
