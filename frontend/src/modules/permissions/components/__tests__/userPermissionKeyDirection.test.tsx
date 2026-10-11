// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { renderForm, stubNetwork, success } from '@/tests/serverRejectionHarness';
import { UserPermissionsDialog } from '../users/UserPermissionsDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const PERMISSION = 'reports:read:all';

registerRtlDocument();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('user permissions dialog in an rtl page in %s', (locale) => {
  it('keeps a direct permission key left to right in its row', async () => {
    stubNetwork(() => success({ userId: 'user-1', role: '', permissions: [PERMISSION] }));
    await renderForm(locale, <UserPermissionsDialog open onOpenChange={vi.fn()} userId="user-1" />);

    const row = await screen.findByTestId(`direct-permission-${PERMISSION}`);
    const key = within(row).getByText(PERMISSION);
    expect({ text: key.textContent, key: key.getAttribute('dir'), row: directionOf(row) }).toEqual({
      text: PERMISSION,
      key: 'ltr',
      row: 'rtl',
    });
  });
});
