import { success } from './serverRejectionHarness';

/** A role as the roles list sends it. */
export function listedRole(slug: string, name: string, level = 1) {
  return {
    id: `role-${slug}`,
    slug,
    name,
    level,
    permissions: [],
    isSystemRole: false,
    isProtected: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

/** `count` custom roles named "Role 1" to "Role <count>". */
export function manyRoles(count: number) {
  return Array.from({ length: count }, (_, index) =>
    listedRole(`role-${index + 1}`, `Role ${index + 1}`),
  );
}

/** What a read of the roles list asked for. */
export function pageAsked(request: Request) {
  const query = new URL(request.url).searchParams;
  return { page: Number(query.get('page')), limit: Number(query.get('limit')) };
}

/** Answers a read of the roles list the way the server does: one page of `roles`. */
export function rolesPage<T>(request: Request, roles: readonly T[]): Response {
  const { page, limit } = pageAsked(request);
  return success({
    roles: roles.slice((page - 1) * limit, page * limit),
    total: roles.length,
    page,
    pages: Math.ceil(roles.length / limit),
  });
}
