// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import DashboardLayout from '../layout';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/users',
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

/** Digits, hyphens, then letters: the shape a right-to-left line reorders. */
const SLUG = '24-7-support';

const ACCOUNT = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: SLUG,
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  linkedProviders: ['email'],
};

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the signed-in role in the dashboard header in %s', (locale) => {
  it('keeps the slug left to right inside an rtl header', async () => {
    stubNetwork(() => success(ACCOUNT));
    await renderForm(
      locale,
      <DashboardLayout>
        <p>page</p>
      </DashboardLayout>,
    );

    const slug = await screen.findByTestId('dashboard-user-role');
    expect({
      text: slug.textContent,
      value: slug.getAttribute('dir'),
      line: slug.parentElement ? directionOf(slug.parentElement) : null,
      shown: slug.parentElement?.textContent,
    }).toEqual({ text: SLUG, value: 'ltr', line: 'rtl', shown: `(${SLUG})` });
  });
});
