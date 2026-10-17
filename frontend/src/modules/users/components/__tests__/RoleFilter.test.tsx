// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
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
  ['an Arabic name', 'دعم العملاء'], // feature:locale-ar
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
  describe.each(NAMES)('%s', (_kind, name) => {
    it('shows the name of the picked role in its own direction, then the label again', async () => {
      stubNetwork(() => success(roles(name)));
      const { message, format } = await renderForm(locale, <Host initial="all" />);

      fireEvent.click(screen.getByTestId('role-filter'));
      fireEvent.click(await screen.findByRole('button', { name }));

      expect(shownValue()).toEqual({ text: name, value: 'auto', line: 'rtl' });
      expect(
        screen.getByRole('button', {
          name: format('users.roleFilterTriggerLabel', { role: name }),
        }),
      ).not.toBeNull();

      fireEvent.click(screen.getByTestId('role-filter'));
      fireEvent.click(await screen.findByTestId('role-filter-all'));

      expect(screen.getByTestId('role-filter').textContent).toBe(message('users.allRoles'));
    });
  });
});
