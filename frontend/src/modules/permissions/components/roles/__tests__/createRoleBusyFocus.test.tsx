// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { CreateRoleDialog } from '../CreateRoleDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const PERMISSION = 'permission-checkbox-users:read:all';
const CONTROLS = [
  'role-name-input',
  'role-description-input',
  PERMISSION,
  'wildcard-permission-checkbox',
  'permission-group-select-all-profile',
  'cancel-button',
  'create-role-button',
] as const;

const ENDINGS = {
  refused: () => refusalWith(409, ErrorCode.CONFLICT),
  unreachable,
} as const;

/** jsdom has no layout, so the observer a checked Radix checkbox asks for never fires. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** The dialog with a name and one permission, and the create request held until settled. */
async function filledDialog(locale: AppLocale) {
  const held = heldAnswer();
  stubNetwork((request) => (request.method === 'GET' ? success({}) : held.answer));
  const form = await renderForm(locale, <CreateRoleDialog open onOpenChange={vi.fn()} />);
  const name = screen.getByTestId('role-name-input');
  fireEvent.change(name, { target: { value: 'Night Support' } });
  fireEvent.click(screen.getByTestId(PERMISSION));
  return { ...form, name, settle: held.settle };
}

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus in the create role dialog while its request runs in %s', (locale) => {
  it.each(['refused', 'unreachable'] as const)(
    'stays on the create button, pressed to send it, when the request is %s',
    async (ending) => {
      const { settle, name } = await filledDialog(locale);
      const create = screen.getByTestId('create-role-button');
      create.focus();

      fireEvent.click(create);

      await expectFocusKeptThroughRequest(create, () => settle(ENDINGS[ending]));
      expect(name).toHaveProperty('value', 'Night Support');
    },
  );

  it.each(['refused', 'unreachable'] as const)(
    'stays in the name field the form was sent from when the request is %s',
    async (ending) => {
      const { settle, name } = await filledDialog(locale);
      name.focus();

      fireEvent.submit(name);

      await expectFocusKeptThroughRequest(name, () => settle(ENDINGS[ending]));
    },
  );

  it('holds every control of the form, permissions included, and leaves them unchanged', async () => {
    const { settle } = await filledDialog(locale);
    const create = screen.getByTestId('create-role-button');
    const controls = () => CONTROLS.map((id) => availability(screen.getByTestId(id)));

    fireEvent.click(create);

    await waitFor(() => expect(create.getAttribute('aria-busy')).toBe('true'));
    expect(controls()).toEqual([HELD, HELD, HELD, HELD, HELD, HELD, HELD]);
    fireEvent.click(screen.getByTestId(PERMISSION));
    fireEvent.click(screen.getByTestId('permission-group-select-all-profile'));
    expect(screen.getByTestId(PERMISSION).getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByTestId('permission-checkbox-profile:read:own').getAttribute('aria-checked'),
    ).toBe('false');

    settle(ENDINGS.refused);

    await waitFor(() => expect(create.getAttribute('aria-busy')).toBe('false'));
    expect(controls()).toEqual([IDLE, IDLE, IDLE, IDLE, IDLE, IDLE, IDLE]);
  });
});
