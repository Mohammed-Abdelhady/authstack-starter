// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { CreateRoleDialog } from '@/modules/permissions/components/roles/CreateRoleDialog';
import { EditRoleDialog } from '@/modules/permissions/components/roles/EditRoleDialog';
import type { Role } from '@/modules/roles/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const ROLE: Role = {
  id: 'role-support',
  name: 'Support Team',
  slug: 'support-team',
  description: 'Answers tickets',
  isSystemRole: false,
  isProtected: false,
  level: 1,
  permissions: ['users:read:all'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

function CreateHost() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="open-role-dialog">
        Open
      </button>
      <CreateRoleDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function EditHost() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="open-role-dialog">
        Open
      </button>
      <EditRoleDialog open={open} onOpenChange={setOpen} role={ROLE} />
    </>
  );
}

async function escapeDialog(testId: string) {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId(testId)).toBeNull());
  fireEvent.click(screen.getByTestId('open-role-dialog'));
  await screen.findByTestId(testId);
}

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each(['en', 'ar'] as const)('role dialog Escape reset in %s', (locale: AppLocale) => {
  it('clears an unsaved create role value and its field error', async () => {
    stubNetwork(() => success({}));
    const form = await renderForm(locale, <CreateHost />);
    const name = screen.getByTestId('role-name-input');
    fireEvent.click(screen.getByTestId('create-role-button'));
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    fireEvent.change(name, { target: { value: 'Draft role' } });

    await escapeDialog('create-role-dialog');

    expect(screen.getByTestId('role-name-input')).toHaveProperty('value', '');
    expect(screen.getByTestId('role-name-input').getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('role-name-error')).toBeNull();
    expect(form.errorToasts()).toEqual([]);
  });

  it('restores the saved edit values and clears validation after Escape', async () => {
    stubNetwork(() => success({}));
    await renderForm(locale, <EditHost />);
    const name = screen.getByTestId('edit-role-name-input');
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('save-role-button'));
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));

    await escapeDialog('edit-role-dialog');

    expect(screen.getByTestId('edit-role-name-input')).toHaveProperty('value', ROLE.name);
    expect(screen.getByTestId('edit-role-name-input').getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('edit-role-name-error')).toBeNull();
  });
});
