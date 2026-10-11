// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { RoleFilter } from '../RoleFilter';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** Digits, hyphens, then letters: the shape a right-to-left line reorders. */
const SLUG = '24-7-support';
const NAMES = [
  ['a Latin name starting with digits', '24-7 Support'],
  ['an Arabic name', 'دعم العملاء'],
] as const;

function roles(name: string) {
  return {
    roles: [
      {
        id: 'role-support',
        slug: SLUG,
        name,
        permissions: [],
        isSystemRole: false,
        isProtected: false,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    totalPages: 1,
  };
}

/** The page that owns the filter value, as the users page does. */
function Host({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <RoleFilter value={value} onChange={setValue} />;
}

function shownValue() {
  const value = screen.getByTestId('role-filter-value');
  return {
    text: value.textContent,
    value: value.getAttribute('dir'),
    line: value.parentElement ? directionOf(value.parentElement) : null,
  };
}

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the role filter in an rtl page in %s', (locale) => {
  it('shows the translated label, not a role value, while every role is listed', async () => {
    const { message } = await renderForm(locale, <Host initial="all" />);

    expect(screen.queryByTestId('role-filter-value')).toBeNull();
    expect(screen.getByTestId('role-filter').textContent).toBe(message('users.allRoles'));
  });

  it.each([SLUG, 'support-team'])(
    'shows the slug %s it has no name for as it is, left to right',
    async (slug) => {
      await renderForm(locale, <Host initial={slug} />);

      expect(shownValue()).toEqual({ text: slug, value: 'ltr', line: 'rtl' });
    },
  );

  describe.each(NAMES)('%s', (_kind, name) => {
    it('lists the role by its name in its own direction', async () => {
      stubNetwork(() => success(roles(name)));
      await renderForm(locale, <Host initial="all" />);

      fireEvent.click(screen.getByTestId('role-filter'));
      const option = await screen.findByRole('button', { name });

      expect(within(option).getByText(name).getAttribute('dir')).toBe('auto');
    });

    it('shows the name of the picked role in its own direction, then the label again', async () => {
      stubNetwork(() => success(roles(name)));
      const { message } = await renderForm(locale, <Host initial="all" />);

      fireEvent.click(screen.getByTestId('role-filter'));
      fireEvent.click(await screen.findByRole('button', { name }));

      expect(shownValue()).toEqual({ text: name, value: 'auto', line: 'rtl' });

      fireEvent.click(screen.getByTestId('role-filter'));
      fireEvent.click(await screen.findByTestId('role-filter-all'));

      expect(screen.getByTestId('role-filter').textContent).toBe(message('users.allRoles'));
    });
  });
});
