// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { PermissionTreeView, WILDCARD_GROUP_ID } from '../permission-tree/PermissionTreeView';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the group headings of a permission tree in %s', (locale) => {
  it('keeps a host resource named wildcard apart from the wildcard permission', async () => {
    await renderForm(
      locale,
      <PermissionTreeView permissions={['wildcard:read:all', '*', 'wildcard:update:all']} />,
    );

    const nodesIn = (listTestId: string) =>
      within(screen.getByTestId(listTestId))
        .getAllByTestId(/^permission-node-/)
        .map((node) => node.getAttribute('data-testid'));
    expect({
      heading: screen.getByTestId('permission-group-wildcard').textContent,
      resource: nodesIn('permission-list-wildcard'),
      wildcard: nodesIn(`permission-list-${WILDCARD_GROUP_ID}`),
      wildcardHeading: screen.queryByTestId(`permission-group-${WILDCARD_GROUP_ID}`),
    }).toEqual({
      heading: 'wildcard',
      resource: ['permission-node-wildcard:read:all', 'permission-node-wildcard:update:all'],
      wildcard: ['permission-node-*'],
      wildcardHeading: null,
    });
  });
});
