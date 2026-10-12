// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { UserActionsMenu } from '../UserActionsMenu';
import { keystroke, pressKey } from './keystroke';
import {
  CONFIRM_DIALOG,
  focusEditorOption,
  renderSelector,
  settledConfirmation,
  stubListLayout,
} from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const MENU_USER = {
  _id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isDeleted: false,
  isVerified: true,
};

const STILL_OPEN = { open: true, listOpen: false };

/** The confirmation as it stands now, and whether focus is on its cancel button. */
function confirmationNow() {
  return {
    dialogs: screen.queryAllByTestId(CONFIRM_DIALOG).length,
    focus: document.activeElement?.getAttribute('data-testid') ?? null,
  };
}

const OPEN_ON_CANCEL = { dialogs: 1, focus: 'cancel-role-change-button' };

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('choosing a role by keyboard in %s', (locale) => {
  it.each(['Enter', ' '] as const)(
    'opens the confirmation and leaves it open when the key is "%s"',
    async (key) => {
      const { onRoleChange } = await focusEditorOption(locale);

      pressKey(key);

      expect(await settledConfirmation(CONFIRM_DIALOG)).toEqual(STILL_OPEN);
      expect(onRoleChange).not.toHaveBeenCalled();
    },
  );

  it.each(['Enter', ' '] as const)(
    'keeps the confirmation when the rest of the "%s" keystroke arrives after it took focus',
    async (key) => {
      const { onRoleChange } = await focusEditorOption(locale);
      const stroke = keystroke(key);

      stroke.down();
      await settledConfirmation(CONFIRM_DIALOG);
      stroke.press();
      stroke.up();

      expect(confirmationNow()).toEqual(OPEN_ON_CANCEL);
      expect(onRoleChange).not.toHaveBeenCalled();
    },
  );

  it.each(['Enter', ' '] as const)(
    'keeps the confirmation while "%s" is held down and repeats',
    async (key) => {
      const { onRoleChange } = await focusEditorOption(locale);
      const stroke = keystroke(key);

      stroke.down();
      stroke.press();
      await settledConfirmation(CONFIRM_DIALOG);
      stroke.repeat();
      stroke.repeat();
      stroke.repeat();
      stroke.up();

      expect(confirmationNow()).toEqual(OPEN_ON_CANCEL);
      expect(onRoleChange).not.toHaveBeenCalled();
    },
  );

  it.each(['Enter', ' '] as const)(
    'keeps the confirmation while "%s" is held down by a keyboard that does not mark its repeats',
    async (key) => {
      const { onRoleChange, heard } = await focusEditorOption(locale);
      const stroke = keystroke(key);

      stroke.down();
      stroke.press();
      await settledConfirmation(CONFIRM_DIALOG);
      stroke.unmarkedRepeat();
      stroke.unmarkedRepeat();
      stroke.unmarkedRepeat();
      stroke.up();

      expect(confirmationNow()).toEqual(OPEN_ON_CANCEL);
      expect(onRoleChange).not.toHaveBeenCalled();
      expect(heard).toEqual(['keydown']);
    },
  );

  it('lets the page hear nothing more of the keystroke that chose the role', async () => {
    const { heard } = await focusEditorOption(locale);
    const stroke = keystroke('Enter');

    stroke.down();
    await settledConfirmation(CONFIRM_DIALOG);
    stroke.press();
    stroke.repeat();
    stroke.up();

    expect(heard).toEqual(['keydown']);
  });

  it('leaves every other key alone while the choosing key is still down', async () => {
    await focusEditorOption(locale);
    const stroke = keystroke('Enter');
    stroke.down();
    await settledConfirmation(CONFIRM_DIALOG);

    const tabReleased = fireEvent.keyUp(screen.getByTestId('cancel-role-change-button'), {
      key: 'Tab',
    });
    stroke.press();
    stroke.up();

    expect(tabReleased).toBe(true);
    expect(confirmationNow()).toEqual(OPEN_ON_CANCEL);
  });

  it('stops holding the key back when it is released', async () => {
    await focusEditorOption(locale);
    const stroke = keystroke('Enter');
    stroke.down();
    await settledConfirmation(CONFIRM_DIALOG);
    stroke.press();
    stroke.up();

    expect(fireEvent.keyUp(document.body, { key: 'Enter' })).toBe(true);
  });

  it('obeys the next press of the same key once the first has been released', async () => {
    await focusEditorOption(locale);
    const stroke = keystroke('Enter');
    stroke.down();
    await settledConfirmation(CONFIRM_DIALOG);
    stroke.press();
    stroke.up();

    pressKey('Enter');

    await waitFor(() => {
      expect(screen.queryByTestId(CONFIRM_DIALOG)).toBeNull();
    });
  });

  it('obeys a new press when the window lost focus before the first was released', async () => {
    await focusEditorOption(locale);
    keystroke('Enter').down();
    await settledConfirmation(CONFIRM_DIALOG);

    fireEvent.blur(window);
    pressKey('Enter');

    await waitFor(() => {
      expect(screen.queryByTestId(CONFIRM_DIALOG)).toBeNull();
    });
  });

  it('goes on holding the key back when focus only moves inside the page', async () => {
    await focusEditorOption(locale);
    const stroke = keystroke('Enter');
    stroke.down();
    await settledConfirmation(CONFIRM_DIALOG);

    fireEvent.blur(screen.getByTestId('cancel-role-change-button'));
    stroke.unmarkedRepeat();
    stroke.up();

    expect(confirmationNow()).toEqual(OPEN_ON_CANCEL);
  });

  it('stops holding the key back once the selector has left the page', async () => {
    const { unmount } = await focusEditorOption(locale);
    keystroke('Enter').down();

    unmount();

    expect(fireEvent.keyPress(document.body, { key: 'Enter', charCode: 13 })).toBe(true);
  });

  it('opens the confirmation once and leaves it open when the option is clicked', async () => {
    const { onRoleChange, trigger } = await renderSelector(locale);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = await screen.findByRole('option', { name: 'Editor' });

    fireEvent.pointerMove(option, { pointerType: 'mouse' });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.pointerUp(option, { pointerType: 'mouse' });
    fireEvent.click(option);

    expect(await settledConfirmation(CONFIRM_DIALOG)).toEqual(STILL_OPEN);
    expect(confirmationNow()).toEqual(OPEN_ON_CANCEL);
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it('changes the role when Enter is pressed on the option and then on the confirm button', async () => {
    const { onRoleChange, message } = await focusEditorOption(locale);

    pressKey('Enter');
    await settledConfirmation(CONFIRM_DIALOG);
    screen.getByRole('button', { name: message('permissions.userRole.changeRole') }).focus();
    pressKey('Enter');

    await waitFor(() => {
      expect(onRoleChange.mock.calls).toEqual([['editor']]);
    });
  });

  it('keeps the deactivate confirmation open when its menu entry is chosen with Enter', async () => {
    const requests = stubNetwork(() => success({ id: MENU_USER._id, isDeleted: true }));
    await renderForm(locale, <UserActionsMenu user={MENU_USER} />);
    fireEvent.keyDown(screen.getByTestId('user-actions-menu-user-7'), { key: 'Enter' });
    (await screen.findByTestId('deactivate-user-user-7')).focus();

    pressKey('Enter');

    expect((await settledConfirmation('user-action-confirm-dialog')).open).toBe(true);
    expect(requests).toEqual([]);
  });
});
