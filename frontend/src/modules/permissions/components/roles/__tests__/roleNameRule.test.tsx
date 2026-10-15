// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { ROLE_AUDIENCE } from '@app/core';
import { stubListLayout } from '../../users/__tests__/roleSelectorHarness';
import {
  descriptions,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import type { Role } from '../../../api/rolesApi';
import { CreateRoleDialog } from '../CreateRoleDialog';
import { EditRoleDialog } from '../EditRoleDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

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

const LENGTHS = { min: 2, max: 50 };

/**
 * Names the forms refuse, with the message that says why and the code shown
 * under the field. No code is shown for a name with a character the server
 * refuses, or for no name at all.
 */
const REFUSED_NAMES = [
  ['one character', 'A', 'nameTooShort', 'a'],
  ['fifty-one characters', 'a'.repeat(51), 'nameTooLong', 'a'.repeat(51)],
  ['a slash', '24/7 Support', 'nameCharacters', ''],
  ['an accented letter', 'Éditeur', 'nameCharacters', ''],
  ['only spaces', '   ', 'nameError', ''],
  ['only hyphens', '--', 'nameCodeTooShort', '-'],
  ['hyphens and spaces', '- -', 'nameCodeTooShort', '-'],
  ['an Arabic name', 'محرر المحتوى', 'nameCharacters', ''], // feature:locale-ar
] as const;

/** The code a new role has before a name is typed, and the role being edited has. */
const INITIAL_CODE = { create: '', edit: 'support-team' } as const;

const FORMS = {
  create: {
    page: <CreateRoleDialog open onOpenChange={vi.fn()} />,
    nameField: 'role-name-input',
    descriptionField: 'role-description-input',
    hint: 'role-name-hint',
    submitKey: 'roles.form.create',
    request: 'POST /api/roles',
    sent: { permissions: ['users:read:all'] },
  },
  edit: {
    page: <EditRoleDialog open onOpenChange={vi.fn()} role={ROLE} />,
    nameField: 'edit-role-name-input',
    descriptionField: 'edit-role-description-input',
    hint: 'edit-role-name-hint',
    submitKey: 'roles.form.update',
    request: 'PATCH /api/roles/role-support',
    sent: { permissions: ['users:read:all'] },
  },
} as const;
type FormName = keyof typeof FORMS;

/** jsdom has no layout, so the observer a checked Radix checkbox asks for never fires. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** The form with a permission chosen, ready to be given a name and sent. */
async function openForm(locale: AppLocale, formName: FormName) {
  const bodies: unknown[] = [];
  const requests = stubNetwork(async (request) => {
    if (request.method === 'GET') return success({});
    bodies.push(await request.json());
    return success({ ...ROLE });
  });
  const form = FORMS[formName];
  const view = await renderForm(locale, form.page);
  const name = await screen.findByTestId(form.nameField);
  if (formName === 'create')
    fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
  const send = () =>
    fireEvent.click(screen.getByRole('button', { name: view.message(form.submitKey) }));
  return { ...view, form, name, send, requests, bodies };
}

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
  stubListLayout();
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the rule for a role name in the role forms in %s', (locale) => {
  it.each([
    [ROLE_AUDIENCE.STAFF, 'audienceStaff'],
    [ROLE_AUDIENCE.CUSTOMER, 'audienceCustomer'],
    [undefined, 'audienceUnset'],
  ] as const)('sends only the chosen create audience %s', async (audience, optionKey) => {
    const { name, send, requests, bodies, message } = await openForm(locale, 'create');
    fireEvent.change(name, { target: { value: 'Support Team' } });
    const select = screen.getByRole('combobox', {
      name: message('roles.form.audienceLabel'),
    });
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    const option = await screen.findByRole('option', {
      name: message(`roles.form.${optionKey}`),
    });
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });

    send();

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          name: 'Support Team',
          permissions: ['users:read:all'],
          ...(audience === undefined ? {} : { audience }),
        },
      ]),
    );
    expect(requests.filter((request) => !request.startsWith('GET'))).toEqual(['POST /api/roles']);
  });

  describe.each(['create', 'edit'] as const)('%s', (formName) => {
    it('says what a name may be, tied to the field before anything is typed', async () => {
      const { name, format, form } = await openForm(locale, formName);
      const code = INITIAL_CODE[formName];

      expect(descriptions(name)).toEqual([
        format('roles.form.nameHint', LENGTHS),
        ...(code ? [format('roles.form.codePreview', { code })] : []),
      ]);
      expect(screen.getByTestId(form.hint).textContent).toBe(
        format('roles.form.nameHint', LENGTHS),
      );
    });

    it.each(REFUSED_NAMES)(
      'refuses a name of %s itself, with the message for it, and sends nothing',
      async (_what, value, messageKey, code) => {
        const { name, send, requests, format } = await openForm(locale, formName);
        fireEvent.change(name, { target: { value } });

        send();

        await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
        expect(descriptions(name)).toEqual([
          format('roles.form.nameHint', LENGTHS),
          ...(code ? [format('roles.form.codePreview', { code })] : []),
          format(`roles.form.${messageKey}`, LENGTHS),
        ]);
        expect(document.activeElement).toBe(name);
        expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([]);
      },
    );

    it.each([
      ['two characters', 'QA', 'QA'],
      ['fifty characters', 'a'.repeat(50), 'a'.repeat(50)],
      ['digits, spaces and hyphens', '24-7 Support', '24-7 Support'],
      ['spaces around it, which are not sent', '  Night Shift  ', 'Night Shift'],
    ])('sends a name of %s', async (_what, value, sentName) => {
      const { name, send, requests, bodies, form } = await openForm(locale, formName);
      fireEvent.change(name, { target: { value } });

      send();

      await waitFor(() =>
        expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([form.request]),
      );
      expect(bodies).toEqual([expect.objectContaining({ ...form.sent, name: sentName })]);
    });

    it.each([
      ['two hundred characters, in any script', 'ب'.repeat(200), true], // feature:locale-ar
      ['two hundred characters', 'a'.repeat(200), true],
      ['two hundred and one characters', 'a'.repeat(201), false],
    ] as const)('a description of %s is sent: %s', async (_what, value, isSent) => {
      const { name, send, requests, format, form } = await openForm(locale, formName);
      const description = screen.getByTestId(form.descriptionField);
      fireEvent.change(name, { target: { value: 'Night Shift' } });
      fireEvent.change(description, { target: { value } });

      send();

      if (isSent) {
        await waitFor(() =>
          expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([form.request]),
        );
        return;
      }
      await waitFor(() => expect(description.getAttribute('aria-invalid')).toBe('true'));
      expect(descriptions(description)).toEqual([
        format('roles.form.descriptionTooLong', { max: 200 }),
      ]);
      // The name is fine, so the focus goes to the field that is not.
      expect(document.activeElement).toBe(description);
      expect(name.getAttribute('aria-invalid')).toBe('false');
      expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([]);
    });
  });

  describe.each(['create', 'edit'] as const)('%s', (formName) => {
    it('focuses the name when the name and the description are both refused', async () => {
      const { name, send, form } = await openForm(locale, formName);
      const description = screen.getByTestId(form.descriptionField);
      fireEvent.change(name, { target: { value: 'A' } });
      fireEvent.change(description, { target: { value: 'a'.repeat(201) } });
      description.focus();

      send();

      await waitFor(() => expect(description.getAttribute('aria-invalid')).toBe('true'));
      expect(document.activeElement).toBe(name);
    });

    it.each([
      ['24 7 Support', '24-7-support'],
      ['24-7 Support', '24-7-support'],
      ['  Night   Shift ', 'night-shift'],
    ])('shows under the name the code that %j will get, as it is typed', async (value, code) => {
      const { name, format, form } = await openForm(locale, formName);

      fireEvent.change(name, { target: { value } });

      const preview = screen.getByTestId(
        form.nameField === 'role-name-input' ? 'role-code-preview' : 'edit-role-code-preview',
      );
      expect(preview.textContent).toBe(format('roles.form.codePreview', { code }));
      expect(descriptions(name)).toEqual([
        format('roles.form.nameHint', LENGTHS),
        format('roles.form.codePreview', { code }),
      ]);
    });

    it('shows no code while the name holds a character the server refuses', async () => {
      const { name, form } = await openForm(locale, formName);

      fireEvent.change(name, { target: { value: '24/7 Support' } });

      expect(
        screen.queryByTestId(
          form.nameField === 'role-name-input' ? 'role-code-preview' : 'edit-role-code-preview',
        ),
      ).toBeNull();
    });
  });

  it('shows a Latin example as the placeholder of the name', async () => {
    const { name, message } = await openForm(locale, 'create');

    const placeholder = name.getAttribute('placeholder') ?? '';
    expect(placeholder).toBe(message('roles.form.namePlaceholder'));
    expect(placeholder.endsWith('Content Editor')).toBe(true);
  });

  it('gives a role whose name cannot be changed no rule to read and does not check its name', async () => {
    const requests = stubNetwork((request) => success(request.method === 'GET' ? {} : ROLE));
    const protectedRole = { ...ROLE, name: 'X', isProtected: true };
    const view = await renderForm(
      locale,
      <EditRoleDialog open onOpenChange={vi.fn()} role={protectedRole} />,
    );
    const name = await screen.findByTestId('edit-role-name-input');

    fireEvent.click(screen.getByRole('button', { name: view.message('roles.form.update') }));

    await waitFor(() =>
      expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([
        'PATCH /api/roles/role-support',
      ]),
    );
    expect(screen.queryByTestId('edit-role-name-hint')).toBeNull();
    expect(descriptions(name)).toEqual([]);
  });
});
