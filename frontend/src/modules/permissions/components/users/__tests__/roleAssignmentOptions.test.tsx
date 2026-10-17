// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { listedRole } from '@/tests/roleList';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { storeSignedInAs } from '@/tests/signedIn';
import { useUserActions } from '../../../hooks/useUserActions';
import { CreateUserDialog } from '../CreateUserDialog';
import { UserRoleSelector } from '../UserRoleSelector';
import { stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** The roles a fresh installation has. Every one of them is protected. */
const SEEDED = [
  { ...listedRole('user', 'User', 1), isSystemRole: true, isProtected: true },
  { ...listedRole('support', 'Support', 2), isSystemRole: true, isProtected: true },
  { ...listedRole('manager', 'Manager', 3), isSystemRole: true, isProtected: true },
  { ...listedRole('admin', 'Admin', 4), isSystemRole: true, isProtected: true },
];

/** The reason shown beside each role that cannot be chosen, by role slug. */
type Reasons = Partial<Record<'user' | 'support' | 'manager' | 'admin', 'admin' | 'level'>>;

/** What the open list offers: for each role, the reason it is held back, or null. */
function offered(form: Awaited<ReturnType<typeof renderForm>>) {
  const list = screen.getByRole('listbox');
  return Object.fromEntries(
    within(list)
      .getAllByRole('option')
      .map((option) => {
        const slug = (option.getAttribute('data-testid') ?? '').replace('role-option-', '');
        const reasons = (['admin', 'level'] as const).filter((reason) =>
          (option.textContent ?? '').includes(
            form.message(`permissions.userRole.refusal.${reason}`),
          ),
        );
        return [
          slug,
          { held: option.getAttribute('aria-disabled') === 'true', reason: reasons[0] ?? null },
        ];
      }),
  );
}

function expected(reasons: Reasons) {
  return Object.fromEntries(
    SEEDED.map(({ slug }) => {
      const reason = reasons[slug as keyof Reasons] ?? null;
      return [slug, { held: reason !== null, reason }];
    }),
  );
}

/** The create user dialog as a person holding `actorRole` sees it, its role list loaded. */
async function createUserDialog(locale: AppLocale, actorRole: string) {
  const bodies: unknown[] = [];
  const requests = stubNetwork(async (request) => {
    if (request.method === 'GET') return success({ roles: SEEDED, total: 4, page: 1, pages: 1 });
    bodies.push(await request.json());
    return success({ id: 'user-9' });
  });
  const form = await renderForm(
    locale,
    <CreateUserDialog open onOpenChange={vi.fn()} />,
    storeSignedInAs(actorRole),
  );
  const trigger = screen.getByRole('combobox', { name: form.message('users.createUser.role') });
  await waitFor(() => expect(trigger.matches(':disabled')).toBe(false));
  return { ...form, trigger, requests, bodies };
}

/** The selector on the card of a support user, wired to the real change request. */
function CardSelector() {
  const { handleRoleChange } = useUserActions();
  return (
    <UserRoleSelector
      userId="user-2"
      currentRole="support"
      onRoleChange={(role) => handleRoleChange({ userId: 'user-2', newRole: role, version: 0 })}
    />
  );
}

async function cardSelector(locale: AppLocale, actorRole: string) {
  const bodies: unknown[] = [];
  stubNetwork(async (request) => {
    if (request.method === 'GET') return success({ roles: SEEDED, total: 4, page: 1, pages: 1 });
    bodies.push(await request.json());
    return success({ id: 'user-2', role: 'manager' });
  });
  const form = await renderForm(locale, <CardSelector />, storeSignedInAs(actorRole));
  const trigger = await screen.findByRole('combobox', {
    name: form.format('permissions.userRole.selectorLabel', { role: 'Support' }),
  });
  return { ...form, trigger, bodies };
}

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the roles a person may hand out, where every role is protected, in %s', (locale) => {
  it('creates the user with the role it showed when the form is sent untouched', async () => {
    const dialog = await createUserDialog(locale, 'admin');
    await waitFor(() => expect(dialog.trigger.textContent).toBe('User'));
    fireEvent.change(screen.getByTestId('create-user-email-input'), {
      target: { value: 'layla@example.com' },
    });
    fireEvent.change(screen.getByTestId('create-user-name-input'), {
      target: { value: 'Layla Haddad' },
    });
    fireEvent.change(screen.getByTestId('create-user-password-input'), {
      target: { value: 'Passw0rd!Layla' },
    });

    fireEvent.click(screen.getByTestId('submit-create-user-button'));

    await waitFor(() =>
      expect(dialog.bodies).toEqual([
        {
          email: 'layla@example.com',
          name: 'Layla Haddad',
          password: 'Passw0rd!Layla',
          role: 'user',
        },
      ]),
    );
  });

  it.each([
    ['admin', { admin: 'admin' }],
    ['manager', { manager: 'level', admin: 'admin' }],
    ['support', { support: 'level', manager: 'level', admin: 'admin' }],
    ['user', { user: 'level', support: 'level', manager: 'level', admin: 'admin' }],
    [
      'a-role-the-list-lacks',
      { user: 'level', support: 'level', manager: 'level', admin: 'admin' },
    ],
  ] as const)(
    'offers a person holding %s, in the create user dialog, what the server accepts',
    async (actorRole, reasons) => {
      const dialog = await createUserDialog(locale, actorRole);

      fireEvent.keyDown(dialog.trigger, { key: 'Enter' });
      await screen.findByRole('listbox');

      expect(offered(dialog)).toEqual(expected(reasons));
    },
  );

  it.each([
    ['admin', { admin: 'admin' }],
    // The role the user already holds stays choosable: it is what is selected.
    ['manager', { manager: 'level', admin: 'admin' }],
    ['support', { manager: 'level', admin: 'admin' }],
  ] as const)(
    'offers a person holding %s, on the card of a support user, what the server accepts',
    async (actorRole, reasons) => {
      const card = await cardSelector(locale, actorRole);

      fireEvent.keyDown(card.trigger, { key: 'Enter' });
      await screen.findByRole('listbox');

      expect(offered(card)).toEqual(expected(reasons));
    },
  );

  it('lets an admin move a user to a protected role the server accepts', async () => {
    const card = await cardSelector(locale, 'admin');
    fireEvent.keyDown(card.trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: /^Manager/ }), { key: 'Enter' });

    fireEvent.click(
      await screen.findByRole('button', { name: card.message('permissions.userRole.changeRole') }),
    );

    await waitFor(() => expect(card.bodies).toEqual([{ role: 'manager', version: 0 }]));
    expect(card.errorToasts()).toEqual([]);
  });

  it('does not open a confirmation for a role that is held back', async () => {
    const card = await cardSelector(locale, 'admin');
    fireEvent.keyDown(card.trigger, { key: 'Enter' });
    const admin = await screen.findByTestId('role-option-admin');

    fireEvent.keyDown(admin, { key: 'Enter' });
    fireEvent.click(admin);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(card.bodies).toEqual([]);
  });
});
