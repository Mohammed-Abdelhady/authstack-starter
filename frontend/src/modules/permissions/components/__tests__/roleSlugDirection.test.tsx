// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { UserCard } from '../users/UserCard';
import { UserPermissionsDialog } from '../users/UserPermissionsDialog';
import { UserPermissionsSummary } from '../users/UserPermissionsSummary';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** Digits, hyphens, then letters: the shape a right-to-left line reorders. */
const SLUG = '24-7-support';
/** Left-to-right isolate and pop directional isolate, written out. */
const ISOLATED_SLUG = `⁦${SLUG}⁩`;

const USER = {
  _id: 'user-1',
  name: 'Layla Haddad',
  email: 'layla@example.com',
  role: SLUG,
  isVerified: true,
  isDeleted: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};

/** The text and direction of a value, and the direction of the line that holds it. */
function valueAndLine(value: HTMLElement) {
  return {
    text: value.textContent,
    value: value.getAttribute('dir'),
    line: value.parentElement ? directionOf(value.parentElement) : null,
  };
}

const SLUG_IN_RTL_LINE = { text: SLUG, value: 'ltr', line: 'rtl' };

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a role slug in an rtl page in %s', (locale) => {
  it('stays left to right on a user card that shows the role as text', async () => {
    await renderForm(locale, <UserCard user={USER} />);

    expect(valueAndLine(screen.getByTestId('user-card-role'))).toEqual(SLUG_IN_RTL_LINE);
  });

  it('stays left to right in the current role of the permissions summary', async () => {
    await renderForm(
      locale,
      <UserPermissionsSummary
        role={SLUG}
        totalCount={3}
        inheritedCount={3}
        directCount={0}
        hasWildcard={false}
        t={(key) => key}
      />,
    );

    expect(valueAndLine(screen.getByTestId('user-permissions-role'))).toEqual(SLUG_IN_RTL_LINE);
  });

  it('leaves the translated "no role" label in the page direction', async () => {
    await renderForm(
      locale,
      <UserPermissionsSummary
        totalCount={0}
        inheritedCount={0}
        directCount={0}
        hasWildcard={false}
        t={(key) => key}
      />,
    );

    expect(screen.queryByTestId('user-permissions-role')).toBeNull();
    expect(directionOf(screen.getByText('noRole'))).toBe('rtl');
  });

  it('stays left to right in the badge and the heading of the inherited permissions', async () => {
    stubNetwork((_request, path) =>
      path.includes('/permissions')
        ? success({ userId: USER._id, role: SLUG, permissions: [] })
        : success({ id: 'role-1', slug: SLUG, name: 'Support', permissions: ['users:read:all'] }),
    );
    const { format } = await renderForm(
      locale,
      <UserPermissionsDialog open onOpenChange={vi.fn()} userId={USER._id} />,
    );

    expect(valueAndLine(await screen.findByTestId('inherited-role-slug'))).toEqual(
      SLUG_IN_RTL_LINE,
    );
    const heading = screen.getByTestId('inherited-heading').textContent;
    expect(heading).toBe(format('permissions.dialog.inheritedFromRole', { role: SLUG }));
    expect(heading).toContain(ISOLATED_SLUG);
  });
});
