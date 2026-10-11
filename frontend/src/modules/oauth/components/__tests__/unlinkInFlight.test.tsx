// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { availability, heldAnswer, HELD } from '@/tests/busyControls';
import { askToClose, isOpen } from '@/tests/dialogBusy';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { LinkedAccounts } from '@/modules/account/components/LinkedAccounts';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/settings' }));

const LINKED_PATH = '/api/user/linked-providers';
const UNLINK_GOOGLE = 'DELETE /api/user/unlink-provider/google';

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('an unlink in flight in %s', (locale) => {
  it('cannot be closed until the answer arrives, and sends one unlink', async () => {
    const held = heldAnswer();
    const requests = stubNetwork((request, path) => {
      if (request.method === 'DELETE') return held.answer;
      return path === LINKED_PATH
        ? success({
            providers: ['email', 'google'],
            unlinkHints: { email: 'not_removable', google: 'allowed' },
          })
        : success({ providers: [{ id: 'google', displayName: 'Google' }] });
    });
    await renderForm(locale, <LinkedAccounts />);
    const google = await screen.findByTestId('linked-account-google');
    const opener = within(google).getByTestId('unlink-google');
    opener.focus();
    fireEvent.click(opener);
    const confirm = await screen.findByTestId('unlink-confirm-google');
    fireEvent.click(confirm);
    await waitFor(() => expect(availability(confirm)).toEqual(HELD));

    await askToClose('unlink-dialog-google');
    fireEvent.click(screen.getByTestId('unlink-cancel-google'));
    await askToClose('unlink-dialog-google');

    expect(isOpen('unlink-dialog-google')).toBe(true);
    expect(requests.filter((entry) => entry === UNLINK_GOOGLE).length).toBe(1);
    held.settle(() => success({}));
    await waitFor(() => expect(screen.queryByTestId('unlink-dialog-google')).toBeNull());
  });
});
