// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  SERVER_TEXT,
  descriptions,
  refuseWrites,
  registerFormTestLifecycle,
  renderForm,
} from '@/tests/serverRejectionHarness';
import type { Role } from '../../../api/rolesApi';
import { CreateRoleDialog } from '../CreateRoleDialog';
import { EditRoleDialog } from '../EditRoleDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** The client accepts a slash; the server's rule for a role name does not. */
const REFUSED_NAME = '24/7 Support';

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

async function submitCreate(locale: AppLocale) {
  const form = await renderForm(locale, <CreateRoleDialog open onOpenChange={vi.fn()} />);
  const label = (key: string) => form.message(`roles.form.${key}`);
  const name = screen.getByTestId('role-name-input');
  const description = screen.getByRole('textbox', { name: label('descriptionLabel') });

  fireEvent.change(name, { target: { value: REFUSED_NAME } });
  fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
  fireEvent.click(screen.getByRole('button', { name: label('create') }));

  return { ...form, name, description };
}

async function submitEdit(locale: AppLocale) {
  const form = await renderForm(locale, <EditRoleDialog open onOpenChange={vi.fn()} role={ROLE} />);
  const label = (key: string) => form.message(`roles.form.${key}`);
  const name = screen.getByTestId('edit-role-name-input');
  const description = screen.getByRole('textbox', { name: label('descriptionLabel') });

  fireEvent.change(name, { target: { value: REFUSED_NAME } });
  fireEvent.click(screen.getByRole('button', { name: label('update') }));

  return { ...form, name, description };
}

/** jsdom has no layout, so the observer a checked Radix checkbox asks for never fires. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a role form refused by the server in %s', (locale) => {
  describe.each([
    ['create', submitCreate],
    ['edit', submitEdit],
  ] as const)('%s', (_form, submit) => {
    it('marks the refused name, focuses it and raises one localized toast', async () => {
      refuseWrites(['name']);

      const { name, description, fieldMessage, generalMessage, errorToasts } = await submit(locale);

      await waitFor(() => {
        expect(name.getAttribute('aria-invalid')).toBe('true');
      });
      expect(descriptions(name)).toEqual([fieldMessage]);
      expect(description.getAttribute('aria-invalid')).toBe('false');
      // The field is focused once the store reports the end of the request.
      await waitFor(() => {
        expect(document.activeElement).toBe(name);
      });
      expect(errorToasts()).toEqual([generalMessage]);
      expect(document.body.textContent).not.toContain(SERVER_TEXT);
    });

    it('marks both fields and focuses the first one on screen', async () => {
      refuseWrites(['description', 'name']);

      const { name, description, fieldMessage } = await submit(locale);

      await waitFor(() => {
        expect(description.getAttribute('aria-invalid')).toBe('true');
      });
      expect(descriptions(description)).toEqual([fieldMessage]);
      expect(name.getAttribute('aria-invalid')).toBe('true');
      await waitFor(() => {
        expect(document.activeElement).toBe(name);
      });
    });

    it('marks no field when the refusal names none of this form', async () => {
      refuseWrites(['nickname']);

      const { name, description, generalMessage, errorToasts } = await submit(locale);

      await waitFor(() => {
        expect(errorToasts()).toEqual([generalMessage]);
      });
      expect(name.getAttribute('aria-invalid')).toBe('false');
      expect(description.getAttribute('aria-invalid')).toBe('false');
    });

    it('clears the mark as soon as the refused field is edited', async () => {
      refuseWrites(['name', 'description']);

      const { name, description } = await submit(locale);
      await waitFor(() => {
        expect(name.getAttribute('aria-invalid')).toBe('true');
      });
      fireEvent.change(name, { target: { value: '24-7 Support' } });
      fireEvent.change(description, { target: { value: 'Around the clock' } });

      expect(name.getAttribute('aria-invalid')).toBe('false');
      expect(descriptions(name)).toEqual([]);
      expect(description.getAttribute('aria-invalid')).toBe('false');
      expect(descriptions(description)).toEqual([]);
    });
  });
});
