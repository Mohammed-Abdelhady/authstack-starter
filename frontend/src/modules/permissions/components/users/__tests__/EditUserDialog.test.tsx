// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  SERVER_TEXT,
  refusalWith,
  descriptions,
  refuseWrites,
  renderForm,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ErrorCode } from '@app/core';
import { EditUserDialog } from '../EditUserDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

async function submitEdit(locale: AppLocale) {
  const form = await renderForm(
    locale,
    <EditUserDialog
      currentVersion={0}
      userId="user-1"
      currentName="Layla Haddad"
      currentEmail="layla@example.com"
      open
      onOpenChange={vi.fn()}
    />,
  );
  const name = screen.getByRole('textbox', { name: form.message('users.editUser.name') });
  const email = screen.getByRole('textbox', { name: form.message('users.editUser.email') });

  fireEvent.change(email, { target: { value: 'layla.haddad@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: form.message('users.editUser.save') }));

  return { ...form, name, email };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('EditUserDialog refused by the server in %s', (locale) => {
  it('focuses the first invalid field when the required email is empty', async () => {
    stubNetwork(() => success({}));
    const form = await renderForm(
      locale,
      <EditUserDialog
        currentVersion={0}
        userId="user-1"
        currentName="Layla Haddad"
        currentEmail="layla@example.com"
        open
        onOpenChange={vi.fn()}
      />,
    );
    const email = screen.getByRole('textbox', { name: form.message('users.editUser.email') });
    fireEvent.change(email, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: form.message('users.editUser.save') }));

    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    expect(document.activeElement).toBe(email);
    expect(email.hasAttribute('required')).toBe(true);
  });

  it('marks and focuses the rejected field and raises no toast', async () => {
    refuseWrites(['email', 'nickname']);

    const { name, email, fieldMessage, errorToasts } = await submitEdit(locale);

    await waitFor(() => {
      expect(email.getAttribute('aria-invalid')).toBe('true');
    });
    expect(descriptions(email)).toEqual([fieldMessage]);
    expect(name.getAttribute('aria-invalid')).toBe('false');
    expect(descriptions(name)).toEqual([]);
    // The field is focused once the store reports the end of the request.
    await waitFor(() => {
      expect(document.activeElement).toBe(email);
    });
    // The marked field says it. No toast repeats it.
    expect(errorToasts()).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('edits only the email of a user whose stored name fails the rule and sends no name', async () => {
    const bodies: unknown[] = [];
    stubNetwork(async (request) => {
      if (request.method !== 'GET') {
        bodies.push(JSON.parse(await request.text()));
      }
      return success({});
    });

    const form = await renderForm(
      locale,
      <EditUserDialog
        currentVersion={0}
        userId="user-1"
        currentName="john_doe"
        currentEmail="layla@example.com"
        open
        onOpenChange={vi.fn()}
      />,
    );
    const email = screen.getByRole('textbox', { name: form.message('users.editUser.email') });
    fireEvent.change(email, { target: { value: 'layla.haddad@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: form.message('users.editUser.save') }));

    await waitFor(() => {
      expect(form.successToasts()).toEqual([form.message('users.editUser.success')]);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('name');
    expect(bodies[0]).toEqual({ version: 0, email: 'layla.haddad@example.com' });
  });

  it.each([
    { name: '  Jose\u0301  ', stored: 'Jos\u00e9' },
    { name: 'john_doe', stored: undefined },
    { name: '12', stored: undefined },
  ])('validates a changed name and sends its NFC value $name', async ({ name, stored }) => {
    const bodies: unknown[] = [];
    stubNetwork(async (request) => {
      if (request.method !== 'GET') bodies.push(JSON.parse(await request.text()));
      return success({});
    });
    const form = await renderForm(
      locale,
      <EditUserDialog
        currentVersion={0}
        userId="user-1"
        currentName="Layla Haddad"
        currentEmail="layla@example.com"
        open
        onOpenChange={vi.fn()}
      />,
    );
    const input = screen.getByRole('textbox', { name: form.message('users.editUser.name') });
    fireEvent.change(input, { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: form.message('users.editUser.save') }));
    if (stored === undefined) {
      await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
      expect(bodies).toEqual([]);
      if (name === '12')
        expect(descriptions(input)).toEqual([form.message('users.editUser.errors.nameNoLetter')]);
      return;
    }
    await waitFor(() =>
      expect(bodies).toEqual([{ version: 0, email: 'layla@example.com', name: stored }]),
    );
  });

  it('gives two dialogs on one page their own controls', async () => {
    const { message } = await renderForm(
      locale,
      <>
        <EditUserDialog
          currentVersion={0}
          userId="user-1"
          currentName="Layla Haddad"
          currentEmail="layla@example.com"
          open
          onOpenChange={vi.fn()}
        />
        <EditUserDialog
          currentVersion={0}
          userId="user-2"
          currentName="Omar Nasser"
          currentEmail="omar@example.com"
          open
          onOpenChange={vi.fn()}
        />
      </>,
    );

    const names = screen.getAllByRole('textbox', {
      name: message('users.editUser.name'),
      hidden: true,
    });

    expect(names.map((field) => field.getAttribute('value'))).toEqual([
      'Layla Haddad',
      'Omar Nasser',
    ]);
    expect(new Set(names.map((field) => field.id)).size).toBe(2);
  });
  it('keeps the draft observation when a newer account version arrives', async () => {
    const bodies: unknown[] = [];
    stubNetwork(async (request) => {
      bodies.push(await request.json());
      return refusalWith(409, ErrorCode.CONFLICT);
    });
    const props = {
      userId: 'user-1',
      currentName: 'Layla Haddad',
      currentEmail: 'layla@example.com',
      open: true,
      onOpenChange: vi.fn(),
    };
    const form = await renderForm(locale, <EditUserDialog {...props} currentVersion={0} />);
    const email = screen.getByRole('textbox', { name: form.message('users.editUser.email') });
    fireEvent.change(email, { target: { value: 'layla.haddad@example.com' } });
    form.rerender(<EditUserDialog {...props} currentVersion={1} />);
    fireEvent.click(screen.getByRole('button', { name: form.message('users.editUser.save') }));
    await waitFor(() =>
      expect(bodies).toEqual([{ email: 'layla.haddad@example.com', version: 0 }]),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((email as HTMLInputElement).value).toBe('layla.haddad@example.com');
    expect(form.successToasts()).toEqual([]);
  });
});
