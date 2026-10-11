// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { directionOf, registerRtlDocument } from '@/tests/direction';
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
  it('keeps the box in the page direction, before and after typing', async () => {
    const { box } = await openSearch(locale);
    const direction = () => ({ own: box.getAttribute('dir'), inForce: directionOf(box) });

    expect(direction()).toEqual({ own: null, inForce: 'rtl' });
    fireEvent.change(box, { target: { value: KEY_QUERY } });
    expect({ ...direction(), value: box.getAttribute('value') }).toEqual({
      own: null,
      inForce: 'rtl',
      value: KEY_QUERY,
    });
  });

  it('finds permissions by a typed key', async () => {
    const { box, shown } = await openSearch(locale);

    fireEvent.change(box, { target: { value: KEY_QUERY } });

    expect(shown()).toEqual({ read: true, create: false });
  });

  // feature:locale-ar:start
  it('finds permissions by an Arabic word only where the labels are Arabic', async () => {
    const { box, shown } = await openSearch(locale);

    fireEvent.change(box, { target: { value: ARABIC_QUERY } });

    expect(box.getAttribute('dir')).toBeNull();
    expect(shown()).toEqual({ read: locale === 'ar', create: false });
  });
  // feature:locale-ar:end
});
