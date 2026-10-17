// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { registerRtlDocument } from '@/tests/direction';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { PermissionSearchDialog } from '../PermissionSearchDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** A leading colon is what a right-to-left box moves to the far end. */
const KEY_QUERY = ':read';
// feature:locale-ar:start
/** The Arabic label of the "read" action. */
const ARABIC_QUERY = 'قراءة';
// feature:locale-ar:end
const READ_KEY = 'users:read:all';
const CREATE_KEY = 'users:create:all';

async function openSearch(locale: AppLocale) {
  const form = await renderForm(
    locale,
    <PermissionSearchDialog
      open
      onOpenChange={vi.fn()}
      selectedPermissions={[]}
      onChange={vi.fn()}
    />,
  );
  const box = screen.getByPlaceholderText(
    form.message('permissions.searchDialog.searchPlaceholder'),
  );
  const shown = () => ({
    read: screen.queryByTestId(`permission-checkbox-${READ_KEY}`) !== null,
    create: screen.queryByTestId(`permission-checkbox-${CREATE_KEY}`) !== null,
  });
  return { ...form, box, shown };
}

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the permission search box in an rtl page in %s', (locale) => {
  it('finds permissions by a typed key', async () => {
    const { box, shown } = await openSearch(locale);

    fireEvent.change(box, { target: { value: KEY_QUERY } });

    expect(shown()).toEqual({ read: true, create: false });
  });

  it('labels the search field and bounds pasted text', async () => {
    const { message } = await openSearch(locale);
    const input = screen.getByRole('textbox', {
      name: message('permissions.searchDialog.searchLabel'),
    });

    expect(input).toHaveProperty('maxLength', 100);
    fireEvent.change(input, { target: { value: 'x'.repeat(101) } });

    expect(input).toHaveProperty('value', 'x'.repeat(100));
  });
});

// feature:locale-ar:start
describe('permission search in Arabic', () => {
  const locale: AppLocale = 'ar';

  it('finds permissions by an Arabic word only where the labels are Arabic', async () => {
    const { box, shown } = await openSearch(locale);

    fireEvent.change(box, { target: { value: ARABIC_QUERY } });

    expect(box.getAttribute('dir')).toBeNull();
    expect(shown()).toEqual({ read: locale === 'ar', create: false });
  });
});
// feature:locale-ar:end
