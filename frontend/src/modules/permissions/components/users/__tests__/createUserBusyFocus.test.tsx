// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import {
  availability,
  expectFocusKeptThroughRequest,
  heldAnswer,
  HELD,
  IDLE,
  unreachable,
} from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { CreateUserDialog } from '../CreateUserDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const CONTROLS = [
  'create-user-email-input',
  'create-user-name-input',
  'create-user-password-input',
  'create-user-role-select',
  'cancel-create-user-button',
  'submit-create-user-button',
] as const;

const ENDINGS = {
  refused: () => refusalWith(409, ErrorCode.EMAIL_ALREADY_EXISTS),
  unreachable,
} as const;

/** The dialog with every field filled and the create request held until settled. */
async function filledDialog(locale: AppLocale) {
  const held = heldAnswer();
  stubNetwork((request) =>
    request.method === 'GET' ? success({ roles: [], total: 0, page: 1 }) : held.answer,
  );
  const form = await renderForm(locale, <CreateUserDialog open onOpenChange={vi.fn()} />);
  const email = screen.getByTestId('create-user-email-input');
  await waitFor(() =>
    expect(screen.getByTestId('create-user-role-select').matches(':disabled')).toBe(false),
  );
  fireEvent.change(email, { target: { value: 'layla@example.com' } });
  fireEvent.change(screen.getByTestId('create-user-name-input'), {
    target: { value: 'Layla Haddad' },
  });
  fireEvent.change(screen.getByTestId('create-user-password-input'), {
    target: { value: 'Passw0rd!Layla' },
  });
  return { ...form, email, settle: held.settle };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus in the create user dialog while its request runs in %s', (locale) => {
  it.each(['refused', 'unreachable'] as const)(
    'stays on the submit button, pressed to send it, when the request is %s',
    async (ending) => {
      const { settle, email } = await filledDialog(locale);
      const submit = screen.getByTestId('submit-create-user-button');
      submit.focus();

      fireEvent.click(submit);

      await expectFocusKeptThroughRequest(submit, () => settle(ENDINGS[ending]));
      expect(email).toHaveProperty('value', 'layla@example.com');
    },
  );

  it.each(['refused', 'unreachable'] as const)(
    'stays in the field the form was sent from when the request is %s',
    async (ending) => {
      const { settle, email } = await filledDialog(locale);
      email.focus();

      fireEvent.submit(email);

      await expectFocusKeptThroughRequest(email, () => settle(ENDINGS[ending]));
    },
  );

  it('holds every control of the form, and the busy one says so, while the request runs', async () => {
    const { settle } = await filledDialog(locale);
    const submit = screen.getByTestId('submit-create-user-button');
    const controls = () => CONTROLS.map((id) => availability(screen.getByTestId(id)));

    fireEvent.click(submit);

    await waitFor(() => expect(submit.getAttribute('aria-busy')).toBe('true'));
    expect(controls()).toEqual([HELD, HELD, HELD, HELD, HELD, HELD]);

    settle(ENDINGS.refused);

    await waitFor(() => expect(submit.getAttribute('aria-busy')).toBe('false'));
    expect(controls()).toEqual([IDLE, IDLE, IDLE, IDLE, IDLE, IDLE]);
  });
});
