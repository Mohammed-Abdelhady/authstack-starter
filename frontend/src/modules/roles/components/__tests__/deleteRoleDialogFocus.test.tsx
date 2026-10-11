// @vitest-environment jsdom
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { focusAfterOpenAndEscape } from '@/tests/dialogFocus';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { RoleDialogs } from '../RoleDialogs';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLE = {
  id: 'role-editor',
  name: 'Editor',
  slug: 'editor',
  isSystemRole: false,
  isProtected: false,
  permissions: ['posts:read:all'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

/** The delete button of a role with the dialogs of the roles page beside it. */
function DeleteButtonAndDialogs() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const ignore = () => undefined;
  return (
    <>
      <button data-testid="delete-role-open" onClick={() => setDeleteOpen(true)} />
      <RoleDialogs
        createOpen={false}
        onCreateOpenChange={ignore}
        editOpen={false}
        onEditOpenChange={ignore}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={setDeleteOpen}
        roleToEdit={ROLE}
        onSuccess={ignore}
      />
    </>
  );
}

registerFormTestLifecycle();

it('returns focus to the delete button when the delete role dialog is closed', async () => {
  const requests = stubNetwork(() => success({}));
  await renderForm('en', <DeleteButtonAndDialogs />);

  expect(await focusAfterOpenAndEscape('delete-role-open', 'delete-role-dialog')).toBe(
    'delete-role-open',
  );
  expect(requests.filter((request) => request.startsWith('DELETE'))).toEqual([]);
});
