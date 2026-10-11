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
import { PASSKEY_NAME_MODE } from '../../types';
import { PasskeyDeleteDialog } from '../PasskeyDeleteDialog';
import { PasskeyNameDialog } from '../PasskeyNameDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const PASSKEY = {
  id: 'pk-1',
  name: 'Laptop',
  deviceType: 'singleDevice',
  backedUp: false,
  createdAt: '2026-01-05T10:00:00.000Z',
  lastUsedAt: null,
} as const;

const DIALOGS = [
  {
    name: 'rename',
    dialogId: 'passkey-name-dialog',
    held: 'passkey-name-input',
    render: (onClose: () => void) => (
      <PasskeyNameDialog
        open
        target={{ passkey: PASSKEY, mode: PASSKEY_NAME_MODE.RENAME }}
        onClose={onClose}
      />
    ),
    send: () => {
      fireEvent.change(screen.getByTestId('passkey-name-input'), {
        target: { value: 'Work laptop' },
      });
      fireEvent.submit(screen.getByTestId('passkey-name-form'));
    },
  },
  {
    name: 'remove',
    dialogId: 'passkey-delete-dialog',
    held: 'passkey-delete-confirm',
    render: (onClose: () => void) => (
      <PasskeyDeleteDialog open passkey={PASSKEY} onClose={onClose} />
    ),
    send: () => fireEvent.click(screen.getByTestId('passkey-delete-confirm')),
  },
] as const;

async function sent(locale: AppLocale, dialog: (typeof DIALOGS)[number]) {
  const held = heldAnswer();
  stubNetwork((request) => (request.method === 'GET' ? success({}) : held.answer));
  const onClose = vi.fn();
  const view = await renderForm(locale, dialog.render(onClose));
  dialog.send();
  return {
    ...view,
    closes: () => onClose.mock.calls.length,
    refuse: () => held.settle(() => refusalWith(500, ErrorCode.INTERNAL_ERROR)),
  };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a passkey dialog with its request in flight in %s', (locale) => {
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
