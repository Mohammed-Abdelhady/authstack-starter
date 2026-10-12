// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { renderForm, registerFormTestLifecycle } from '@/tests/serverRejectionHarness';
import { pressKey } from '../users/__tests__/keystroke';
import { SearchPermissionGrid } from '../search/SearchPermissionGrid';
import { PermissionGroupGrid } from '../selector/PermissionGroupGrid';

const PERMISSIONS = {
  usersRead: 'users:read:all',
  rolesRead: 'roles:read:all',
};

class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function GridHost({ search = false }: { search?: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const Grid = search ? SearchPermissionGrid : PermissionGroupGrid;
  return (
    <Grid
      permissions={PERMISSIONS}
      selectedPermissions={selected}
      onTogglePermission={(permission) =>
        setSelected((current) =>
          current.includes(permission)
            ? current.filter((entry) => entry !== permission)
            : [...current, permission],
        )
      }
    />
  );
}

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each(['en', 'ar'] as const)('permission checkbox names in %s', (locale: AppLocale) => {
  it.each([
    ['selector', false],
    ['search', true],
  ] as const)('distinguishes equal labels in the %s and supports Space', async (_grid, search) => {
    await renderForm(locale, <GridHost search={search} />);
    const usersRead = screen.getByRole('checkbox', { name: /users:read:all/ });
    const rolesRead = screen.getByRole('checkbox', { name: /roles:read:all/ });

    expect(usersRead.getAttribute('aria-checked')).toBe('false');
    expect(rolesRead.getAttribute('aria-checked')).toBe('false');
    usersRead.focus();
    pressKey(' ');

    expect(usersRead.getAttribute('aria-checked')).toBe('true');
    expect(rolesRead.getAttribute('aria-checked')).toBe('false');
  });
});
