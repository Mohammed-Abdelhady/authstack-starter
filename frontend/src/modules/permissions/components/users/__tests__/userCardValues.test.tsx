// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { USER_PERMISSIONS } from '@app/core';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { registerFormTestLifecycle, stubNetwork, success } from '@/tests/serverRejectionHarness';
import { renderAdminCard } from './adminEmailConfirmationHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** 83 characters: longer than a card is wide at any breakpoint. */
const LONG_EMAIL =
  '1234567890.very.long.address.for.the.truncation.check@subdomain.example-company.com';
const ROLE_SLUG = '24-7-support';
const ROLE_NAME = '24-7 Support';

const USER = {
  _id: 'user-1',
  name: 'Layla Haddad',
  email: LONG_EMAIL,
  role: ROLE_SLUG,
  isVerified: true,
  isDeleted: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};
const INACTIVE_USER = { ...USER, isDeleted: true };

const ROLE = {
  id: 'role-support',
  slug: ROLE_SLUG,
  name: ROLE_NAME,
  permissions: [],
  isSystemRole: false,
  isProtected: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

/** Answers the role list with these roles and records every request. */
function stubRoleList(roles: Array<typeof ROLE>) {
  return stubNetwork(() => success({ roles, total: roles.length, page: 1 }));
}

/** A value on the card: its text, its own direction, the line's, and whether Tab stops on it. */
function shownValue(testId: string) {
  const value = screen.getByTestId(testId);
  return {
    text: value.textContent,
    dir: value.getAttribute('dir'),
    line: value.parentElement ? directionOf(value.parentElement) : null,
    tabStop: value.hasAttribute('tabindex'),
  };
}

beforeAll(() => {
  // The listbox of the select needs two DOM methods jsdom does not have.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the values on a user card in an rtl page in %s', (locale) => {
  it('keeps the whole address in the page, left to right, without a tab stop', async () => {
    stubRoleList([ROLE]);
    await renderAdminCard(locale, USER);

    expect(shownValue('user-card-email')).toEqual({
      text: LONG_EMAIL,
      dir: 'ltr',
      line: 'rtl',
      tabStop: false,
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('lets the name take its own direction without a tab stop', async () => {
    stubRoleList([ROLE]);
    await renderAdminCard(locale, USER);

    expect(shownValue('user-card-name')).toEqual({
      text: 'Layla Haddad',
      dir: 'auto',
      line: 'rtl',
      tabStop: false,
    });
  });

  it('names the role of an inactive account as the selector names it', async () => {
    const requests = stubRoleList([ROLE]);
    const inactive = await renderAdminCard(locale, INACTIVE_USER);

    await waitFor(() => {
      expect(shownValue('user-card-role')).toEqual({
        text: ROLE_NAME,
        dir: 'auto',
        line: 'rtl',
        tabStop: false,
      });
    });
    expect(screen.getByTestId('user-inactive-badge')).not.toBeNull();
    expect(requests).toEqual(['GET /api/roles']);

    inactive.rerenderUser(USER);
    await waitFor(() => {
      expect(screen.getByRole('combobox').textContent).toBe(ROLE_NAME);
    });
    expect(screen.queryByTestId('user-card-role')).toBeNull();
  });

  it('shows the slug, left to right, for a role the list does not hold', async () => {
    const requests = stubRoleList([{ ...ROLE, slug: 'editor', name: 'Editor' }]);
    await renderAdminCard(locale, INACTIVE_USER);

    await waitFor(() => {
      expect(requests).toEqual(['GET /api/roles']);
    });
    expect(shownValue('user-card-role')).toEqual({
      text: ROLE_SLUG,
      dir: 'ltr',
      line: 'rtl',
      tabStop: false,
    });
  });

  it('shows the slug and asks for no role list when the viewer cannot change roles', async () => {
    const requests = stubRoleList([ROLE]);
    await renderAdminCard(locale, INACTIVE_USER, [USER_PERMISSIONS.READ_ALL]);

    expect(shownValue('user-card-role')).toEqual({
      text: ROLE_SLUG,
      dir: 'ltr',
      line: 'rtl',
      tabStop: false,
    });
    expect(requests).toEqual([]);
  });
});
