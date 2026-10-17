import {
  ROLE_SLUG_MAX_LENGTH,
  ROLE_SLUG_REGEX,
} from '../../common/constants/roles';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../host/types/host-role.type';
import type { AudienceApplyOptions } from '../types/audience-apply';

export function audienceApplyArguments(
  args: readonly string[],
): AudienceApplyOptions {
  let dryRun = false;
  const roles = new Map<string, RoleAudience>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      if (dryRun) throw new Error('Duplicate --dry-run');
      dryRun = true;
      continue;
    }
    const mapping =
      argument === '--role'
        ? args[++index]
        : argument.startsWith('--role=')
          ? argument.slice('--role='.length)
          : undefined;
    const [slug, audience, extra] = mapping?.split('=') ?? [];
    if (
      !slug ||
      slug.length > ROLE_SLUG_MAX_LENGTH ||
      !ROLE_SLUG_REGEX.test(slug) ||
      extra !== undefined ||
      (audience !== ROLE_AUDIENCE.CUSTOMER && audience !== ROLE_AUDIENCE.STAFF)
    ) {
      throw new Error(
        'Usage: audience:apply [--dry-run] [--role slug=customer|staff]',
      );
    }
    if (roles.has(slug)) throw new Error(`Duplicate --role mapping: ${slug}`);
    roles.set(slug, audience);
  }
  return { dryRun, roles };
}
