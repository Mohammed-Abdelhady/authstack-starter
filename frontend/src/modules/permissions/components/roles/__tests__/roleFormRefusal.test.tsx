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

/** A name the form accepts and the server in these tests still refuses. */
const REFUSED_NAME = 'Reserved Name';
const NAME_LENGTHS = { min: 2, max: 50 };

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
    it('marks the refused name, focuses it and raises no toast', async () => {
      refuseWrites(['name']);

      const { name, description, fieldMessage, errorToasts, format } = await submit(locale);

      await waitFor(() => {
        expect(name.getAttribute('aria-invalid')).toBe('true');
      });
      // The rule for a name stays on the field, with the refusal after it.
      expect(descriptions(name)).toEqual([
        format('roles.form.nameHint', NAME_LENGTHS),
        fieldMessage,
      ]);
      expect(description.getAttribute('aria-invalid')).toBe('false');
      // The field is focused once the store reports the end of the request.
      await waitFor(() => {
        expect(document.activeElement).toBe(name);
      });
      // The marked field says it. No toast repeats it.
      expect(errorToasts()).toEqual([]);
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

    it('says so in the form, and marks no field, when the refusal names none of this form', async () => {
      refuseWrites(['nickname']);

      const { name, description, generalMessage, errorToasts } = await submit(locale);

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(generalMessage);
      expect(errorToasts()).toEqual([]);
      expect(name.getAttribute('aria-invalid')).toBe('false');
      expect(description.getAttribute('aria-invalid')).toBe('false');
    });

    it('clears the mark as soon as the refused field is edited', async () => {
      refuseWrites(['name', 'description']);

      const { name, description, format } = await submit(locale);
      await waitFor(() => {
        expect(name.getAttribute('aria-invalid')).toBe('true');
      });
      fireEvent.change(name, { target: { value: '24-7 Support' } });
      fireEvent.change(description, { target: { value: 'Around the clock' } });

      expect(name.getAttribute('aria-invalid')).toBe('false');
      expect(descriptions(name)).toEqual([format('roles.form.nameHint', NAME_LENGTHS)]);
      expect(description.getAttribute('aria-invalid')).toBe('false');
      expect(descriptions(description)).toEqual([]);
    });
  });
});
