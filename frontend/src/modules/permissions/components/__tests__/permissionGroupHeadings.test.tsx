// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { PermissionTreeView } from '../permission-tree/PermissionTreeView';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the group headings of a permission tree in %s', (locale) => {
  it('names each known group from the catalogue, as the category tabs do', async () => {
    const { message } = await renderForm(
      locale,
      <PermissionTreeView permissions={['users:read:all', 'sessions:read:own']} />,
    );

    expect(
      ['users', 'sessions'].map((group) => {
        const heading = screen.getByTestId(`permission-group-${group}`);
        return { text: heading.textContent, dir: directionOf(heading) };
      }),
    ).toEqual([
      { text: message('permissions.selector.groups.users'), dir: 'rtl' },
      { text: message('permissions.selector.groups.sessions'), dir: 'rtl' },
    ]);
  });

  it('shows a group the catalogue does not know as its key, left to right', async () => {
    await renderForm(locale, <PermissionTreeView permissions={['posts:read:all']} />);

    const heading = screen.getByTestId('permission-group-posts');
    expect({
      text: heading.textContent,
      dir: heading.firstElementChild?.getAttribute('dir') ?? null,
    }).toEqual({ text: 'posts', dir: 'ltr' });
  });

  it('gives the wildcard no group heading', async () => {
    await renderForm(locale, <PermissionTreeView permissions={['*']} />);

    expect(screen.getByTestId('permission-node-*')).not.toBeNull();
    expect(screen.queryByTestId('permission-group-wildcard')).toBeNull();
  });
});
