// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { UserCard } from '../../users/UserCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** 83 characters: longer than a card is wide at any breakpoint. */
const LONG_EMAIL =
  '1234567890.very.long.address.for.the.truncation.check@subdomain.example-company.com';

const USER = {
  _id: 'user-1',
  name: 'Layla Haddad',
  email: LONG_EMAIL,
  role: 'user',
  isVerified: true,
  isDeleted: true,
  createdAt: '2026-10-01T12:00:00.000Z',
};

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a long address on a user card in %s', (locale) => {
  it('keeps the whole address in the page and reachable by keyboard', async () => {
    await renderForm(locale, <UserCard user={USER} />);

    const email = screen.getByTestId('user-card-email');
    expect({ text: email.textContent, tabStop: email.tabIndex, dir: directionOf(email) }).toEqual({
      text: LONG_EMAIL,
      tabStop: 0,
      dir: 'ltr',
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the whole address left to right in a tooltip on keyboard focus', async () => {
    await renderForm(locale, <UserCard user={USER} />);

    act(() => {
      screen.getByTestId('user-card-email').focus();
    });

    const tooltip = await screen.findByRole('tooltip');
    expect({ text: tooltip.textContent, dir: directionOf(tooltip) }).toEqual({
      text: LONG_EMAIL,
      dir: 'ltr',
    });
  });

  it('closes the tooltip when focus leaves the address', async () => {
    await renderForm(locale, <UserCard user={USER} />);
    const email = screen.getByTestId('user-card-email');

    act(() => {
      email.focus();
    });
    await screen.findByRole('tooltip');
    act(() => {
      email.blur();
    });

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not add a tab stop for the user name', async () => {
    await renderForm(locale, <UserCard user={USER} />);

    expect(screen.getByTestId('user-card-name').hasAttribute('tabindex')).toBe(false);
  });
});
