// @vitest-environment jsdom
import { isHeld } from '@/tests/busyControls';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import type { AppLocale } from '@/i18n/load-messages';
import {
  refusal,
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

/** The client accepts a slash; the server's rule for a role name does not. */
const REFUSED_NAME = '24/7 Support';
const ACCEPTED_NAME = '24-7 Support';

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

/** Refuses a write that carries the refused name and accepts any other. */
function refuseTheSlash() {
  return stubNetwork(async (request) => {
    if (request.method === 'GET') return success({});
    const body = await request.text();
    return body.includes(REFUSED_NAME)
      ? refusal(['name'])
      : success({ ...ROLE, name: ACCEPTED_NAME });
  });
}

const FORMS = [
  {
    form: 'create',
    render: () => <CreateRoleDialog open onOpenChange={() => undefined} />,
    nameField: 'role-name-input',
    submitKey: 'roles.form.create',
    successKey: 'roles.form.createSuccess',
    tickPermission: true,
  },
  {
    form: 'edit',
    render: () => <EditRoleDialog open onOpenChange={() => undefined} role={ROLE} />,
    nameField: 'edit-role-name-input',
    submitKey: 'roles.form.update',
    successKey: 'roles.form.updateSuccess',
    tickPermission: false,
  },
] as const;

async function openForm(
  locale: AppLocale,
  { render, nameField, submitKey, ...rest }: (typeof FORMS)[number],
) {
  const form = await renderForm(locale, render());
  if (rest.tickPermission)
    fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
  const submitName = (name: string) => {
    fireEvent.change(screen.getByTestId(nameField), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: form.message(submitKey) }));
  };
  return { ...form, submitName };
}

/** The order in which the toasts were dismissed and the success was announced. */
function dismissalsAndSuccesses(): string[] {
  const calls = [
    ...vi
      .mocked(sonnerToast.dismiss)
      .mock.invocationCallOrder.map((at) => ({ at, what: 'dismiss' })),
    ...vi
      .mocked(sonnerToast.success)
      .mock.invocationCallOrder.map((at) => ({ at, what: 'success' })),
  ];
  return calls.sort((a, b) => a.at - b.at).map(({ what }) => what);
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
] as const)('the toasts of a role form in %s', (locale) => {
  describe.each(FORMS)('$form', (formCase) => {
    it('takes the refusal toast down before announcing the corrected save', async () => {
      refuseTheSlash();
      const { submitName, format, generalMessage, errorToasts, successToasts } = await openForm(
        locale,
        formCase,
      );

      submitName(REFUSED_NAME);
      await waitFor(() => {
        expect(errorToasts()).toEqual([generalMessage]);
      });
      expect(dismissalsAndSuccesses()).toEqual([]);
      await waitFor(() => {
        expect(isHeld(screen.getByTestId(formCase.nameField))).toBe(false);
      });
      submitName(ACCEPTED_NAME);

      await waitFor(() => {
        expect(successToasts()).toEqual([format(formCase.successKey, { name: ACCEPTED_NAME })]);
      });
      expect(dismissalsAndSuccesses()).toEqual(['dismiss', 'success']);
      // Called with no id: every toast on screen goes.
      expect(vi.mocked(sonnerToast.dismiss).mock.calls).toEqual([[]]);
    });

    it('dismisses nothing when the first save is accepted', async () => {
      refuseTheSlash();
      const { submitName, format, successToasts } = await openForm(locale, formCase);

      submitName(ACCEPTED_NAME);

      await waitFor(() => {
        expect(successToasts()).toEqual([format(formCase.successKey, { name: ACCEPTED_NAME })]);
      });
      expect(dismissalsAndSuccesses()).toEqual(['success']);
    });
  });
});
