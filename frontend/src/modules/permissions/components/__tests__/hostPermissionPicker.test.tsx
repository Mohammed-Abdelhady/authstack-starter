// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { registerRtlDocument } from '@/tests/direction';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { ALL_PERMISSIONS } from '@app/core';
import { ALL_GROUPS_TAB, buildPermissionGroups } from '../../constants/permissionGroups';
import { PermissionSelector } from '../selector/PermissionSelector';
import { SearchPermissionTabs } from '../search/SearchPermissionTabs';

const HOST_PERMISSION = 'orders:refund:all';
const HOST_GROUPS = buildPermissionGroups(ALL_PERMISSIONS, [HOST_PERMISSION]);
/** A host resource named like the tab that lists every group. */
const ALL_RESOURCE_PERMISSION = 'all:read:all';
const ALL_RESOURCE_GROUPS = buildPermissionGroups(ALL_PERMISSIONS, [ALL_RESOURCE_PERMISSION]);
const PROTO_PERMISSION = '__proto__:read:all';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

registerFormTestLifecycle();
registerRtlDocument();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

/** Activates a tab the way a pointer does. */
function activate(tab: HTMLElement): void {
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
}

/** Element ids and test ids that occur more than once. */
function repeatedIds(): string[] {
  const seen = [...document.querySelectorAll('[id], [data-testid]')].flatMap((element) =>
    [element.id, element.getAttribute('data-testid') ?? ''].filter((id) => id !== ''),
  );
  return seen.filter((id, index) => seen.indexOf(id) !== index);
}

/** What the tabs show: how many are selected, how many panels, any repeated id. */
function tabState() {
  return {
    selectedTabs: screen.getAllByRole('tab', { selected: true }).length,
    panels: screen.getAllByRole('tabpanel').length,
    repeated: repeatedIds(),
  };
}

function checkboxesIn(panel: HTMLElement): (string | null)[] {
  return within(panel)
    .getAllByRole('checkbox')
    .map((checkbox) => checkbox.getAttribute('data-testid'));
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a host permission in the picker in %s', (locale) => {
  it('shows under its resource, named by its key left to right, and can be picked', async () => {
    const onChange = vi.fn();
    const { format } = await renderForm(
      locale,
      <PermissionSelector selectedPermissions={[]} onChange={onChange} groups={HOST_GROUPS} />,
    );
    const tab = screen.getByTestId('permission-group-tab-orders');

    fireEvent.click(screen.getByTestId(`permission-checkbox-${HOST_PERMISSION}`));

    expect({
      tab: tab.textContent,
      dir: tab.querySelector('[dir]')?.getAttribute('dir') ?? null,
      selectAll: screen
        .getByTestId('permission-group-select-all-orders')
        .getAttribute('aria-label'),
      picked: onChange.mock.calls,
    }).toEqual({
      tab: 'orders',
      dir: 'ltr',
      selectAll: format('permissions.selector.selectAllForGroup', { group: 'orders' }),
      picked: [[[HOST_PERMISSION]]],
    });
  });

  it('lists only the host permissions once its resource tab is active', async () => {
    await renderForm(
      locale,
      <PermissionSelector selectedPermissions={[]} onChange={vi.fn()} groups={HOST_GROUPS} />,
    );

    activate(screen.getByTestId('permission-group-tab-orders'));

    expect(checkboxesIn(screen.getByRole('tabpanel'))).toEqual([
      `permission-checkbox-${HOST_PERMISSION}`,
    ]);
  });

  it('keeps a host resource named all apart from the tab that lists every group', async () => {
    await renderForm(
      locale,
      <PermissionSelector
        selectedPermissions={[]}
        onChange={vi.fn()}
        groups={ALL_RESOURCE_GROUPS}
      />,
    );
    const first = tabState();

    activate(screen.getByTestId('permission-group-tab-all'));

    expect({
      first,
      second: tabState(),
      listed: checkboxesIn(screen.getByRole('tabpanel')),
    }).toEqual({
      first: { selectedTabs: 1, panels: 1, repeated: [] },
      second: { selectedTabs: 1, panels: 1, repeated: [] },
      listed: [`permission-checkbox-${ALL_RESOURCE_PERMISSION}`],
    });
  });

  it('keeps a host resource named all apart in the search picker', async () => {
    await renderForm(
      locale,
      <SearchPermissionTabs
        activeTab={ALL_GROUPS_TAB}
        onTabChange={vi.fn()}
        filteredGroups={ALL_RESOURCE_GROUPS.map((group) => ({
          ...group,
          filteredPermissions: group.permissions,
        }))}
        selectedPermissions={[]}
        onSelectAll={vi.fn()}
        onTogglePermission={vi.fn()}
        searchQuery=""
        groups={ALL_RESOURCE_GROUPS}
      />,
    );

    expect(tabState()).toEqual({ selectedTabs: 1, panels: 1, repeated: [] });
  });

  it('counts the selected permissions of a resource named __proto__', async () => {
    await renderForm(
      locale,
      <PermissionSelector
        selectedPermissions={[PROTO_PERMISSION]}
        onChange={vi.fn()}
        groups={buildPermissionGroups([], [PROTO_PERMISSION])}
      />,
    );

    expect(screen.getByTestId('permission-group-tab-__proto__').textContent).toBe('__proto__1');
  });
});
