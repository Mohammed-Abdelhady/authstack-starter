// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { heldAnswer } from '@/tests/busyControls';
import { expectClosableOnlyOnceSettled } from '@/tests/dialogBusy';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { RegenerateCodesDialog } from '../RegenerateCodesDialog';
import { TwoFactorDisableDialog } from '../TwoFactorDisableDialog';
import { TwoFactorSetupDialog } from '../TwoFactorSetupDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

type OpenChange = (open: boolean) => void;

const DIALOGS = [
  {
    name: 'turn off',
    dialogId: 'two-factor-disable-dialog',
    render: (onOpenChange: OpenChange) => (
      <TwoFactorDisableDialog open onOpenChange={onOpenChange} hasPassword={false} />
    ),
    send: () => {
      type('two-factor-code-input', '123456');
      fireEvent.submit(screen.getByTestId('two-factor-disable-form'));
    },
    held: 'two-factor-code-input',
  },
  {
    name: 'new recovery codes',
    dialogId: 'two-factor-regenerate-dialog',
    render: (onOpenChange: OpenChange) => (
      <RegenerateCodesDialog open onOpenChange={onOpenChange} />
    ),
    send: () => {
      type('two-factor-regenerate-code', '123456');
      fireEvent.submit(screen.getByTestId('two-factor-regenerate-form'));
    },
    held: 'two-factor-regenerate-code',
  },
  {
    name: 'setup',
    dialogId: 'two-factor-setup-dialog',
    render: (onOpenChange: OpenChange) => (
      <TwoFactorSetupDialog open onOpenChange={onOpenChange} hasPassword />
    ),
    send: () => {
      type('two-factor-reauth-password', 'Passw0rdLayla');
      fireEvent.submit(screen.getByTestId('two-factor-reauth-form'));
    },
    held: 'two-factor-reauth-password',
  },
] as const;

async function sent(locale: AppLocale, dialog: (typeof DIALOGS)[number]) {
  const held = heldAnswer();
  stubNetwork((request) => (request.method === 'GET' ? success({}) : held.answer));
  const onOpenChange = vi.fn<OpenChange>();
  const view = await renderForm(locale, dialog.render(onOpenChange));
  dialog.send();
  return {
    ...view,
    closes: () => onOpenChange.mock.calls.filter(([open]) => !open).length,
    refuse: () => held.settle(() => refusalWith(500, ErrorCode.INTERNAL_ERROR)),
  };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a two-step verification dialog with its request in flight in %s', (locale) => {
  it.each(DIALOGS)(
    '$name: cannot be closed until the answer arrives, then says why once, inside',
    async (dialog) => {
      const view = await sent(locale, dialog);

      await expectClosableOnlyOnceSettled({
        dialogId: dialog.dialogId,
        closes: view.closes,
        refuse: view.refuse,
        heldControl: () => screen.getByTestId(dialog.held),
      });

      expect(view.errorToasts()).toEqual([]);
      expect(document.body.textContent).not.toContain(SERVER_TEXT);
    },
  );

  it.each(DIALOGS)('$name: shows the reason of the refusal in the dialog', async (dialog) => {
    const view = await sent(locale, dialog);

    view.refuse();

    const reason = await screen.findByRole('alert');
    expect(reason.textContent).toBe(view.message('errors.codes.INTERNAL_ERROR'));
    expect(screen.getByTestId(dialog.dialogId).contains(reason)).toBe(true);
  });
});
