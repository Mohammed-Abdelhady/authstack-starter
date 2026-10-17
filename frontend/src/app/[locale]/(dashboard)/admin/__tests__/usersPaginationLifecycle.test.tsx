// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { USER_PERMISSIONS } from '@app/core';
import { API_PATHS } from '@app/sdk';
import UsersPage from '@/app/[locale]/(dashboard)/admin/users/page';
import { baseApi } from '@/store/api/baseApi';
import type { AppLocale } from '@/i18n/load-messages';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { storeSignedInAs } from '@/tests/signedIn';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const AUTH_DISCOVERY = {
  methods: {
    password: false,
    magicLink: false,
    emailCode: false,
    twoFactor: false,
    passkeys: false,
    oauth: [],
  },
  audiencesEnabled: false,
};

const PAGE_INFO = 'pagination.pageInfo';

function pageResult(requestedPage: number, totalPages: number, phase: string) {
  const row = {
    id: `page-${requestedPage}-${phase}`,
    name: `User ${requestedPage} ${phase}`,
    email: `user${requestedPage}@example.test`,
    role: 'editor',
    isVerified: true,
    isDeleted: false,
    createdAt: '2026-10-01T12:00:00.000Z',
  };
  return success({
    data: [row],
    pagination: {
      total: totalPages * 20,
      page: requestedPage,
      limit: 20,
      totalPages,
    },
  });
}

function pageFrom(request: Request): number {
  return Number(new URL(request.url).searchParams.get('page') ?? '1');
}

registerFormTestLifecycle();

const DESCRIBE_BY_LOCALE = describe.each([
  'en',
  'ar', // feature:locale-ar
] as const);

DESCRIBE_BY_LOCALE('user pagination after the result count changes in %s', (locale: AppLocale) => {
  it('does not keep previous page rows interactive while the new page is pending', async () => {
    let releasePageTwo: ((response: Response) => void) | undefined;
    stubNetwork((request, path) => {
      if (path === API_PATHS.auth.methods) return success(AUTH_DISCOVERY);
      if (path === '/api/roles') return success({ roles: [], total: 0, page: 1, pages: 1 });
      if (path !== '/api/admin/users') return success({});
      const requestedPage = Number(new URL(request.url).searchParams.get('page') ?? '1');
      if (requestedPage === 2) {
        return new Promise<Response>((resolve) => {
          releasePageTwo = resolve;
        });
      }
      return pageResult(1, 2, 'initial');
    });

    await renderForm(
      locale,
      <UsersPage />,
      storeSignedInAs('admin', Object.values(USER_PERMISSIONS)),
    );
    await screen.findByTestId('user-card-page-1-initial');

    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() => expect(releasePageTwo).toBeDefined());

    const oldRowVisible = screen.queryByTestId('user-card-page-1-initial') !== null;
    const oldActionsVisible = screen.queryByTestId('user-role-selector-page-1-initial') !== null;

    await act(async () => releasePageTwo?.(pageResult(2, 2, 'current')));
    await screen.findByTestId('user-card-page-2-current');
    expect(oldRowVisible).toBe(false);
    expect(oldActionsVisible).toBe(false);
    expect(screen.queryByTestId('user-card-page-1-initial')).toBeNull();
  });

  it('hides previous rows as search input moves ahead of its debounced request', async () => {
    let releaseSearch: ((response: Response) => void) | undefined;
    stubNetwork((request, path) => {
      if (path === API_PATHS.auth.methods) return success(AUTH_DISCOVERY);
      if (path === '/api/roles') return success({ roles: [], total: 0, page: 1, pages: 1 });
      if (path !== '/api/admin/users') return success({});
      if (new URL(request.url).searchParams.get('search') === 'new') {
        return new Promise<Response>((resolve) => {
          releaseSearch = resolve;
        });
      }
      return pageResult(1, 2, 'initial');
    });

    const page = await renderForm(
      locale,
      <UsersPage />,
      storeSignedInAs('admin', Object.values(USER_PERMISSIONS)),
    );
    await screen.findByTestId('user-card-page-1-initial');
    fireEvent.change(screen.getByTestId('search-users-input'), { target: { value: 'new' } });
    const oldRowImmediatelyVisible = screen.queryByTestId('user-card-page-1-initial') !== null;

    await waitFor(() => expect(releaseSearch).toBeDefined());
    const oldRowWhileSearchIsPending = screen.queryByTestId('user-card-page-1-initial') !== null;
    const oldActionsWhileSearchIsPending =
      screen.queryByTestId('user-role-selector-page-1-initial') !== null;
    await act(async () => releaseSearch?.(pageResult(1, 1, 'matching')));
    await screen.findByTestId('user-card-page-1-matching');

    expect(oldRowImmediatelyVisible).toBe(false);
    expect(oldRowWhileSearchIsPending).toBe(false);
    expect(oldActionsWhileSearchIsPending).toBe(false);
    expect(screen.getByText(page.format('users.count', { count: 20 }))).not.toBeNull();
    expect(screen.queryByTestId('pagination-next')).toBeNull();
  });

  it('clamps once, then stays on page two when the result grows again', async () => {
    let phase = 'initial';
    let releaseShrink: ((response: Response) => void) | undefined;
    let releaseGrowth: ((response: Response) => void) | undefined;
    let pageThreeGrowthReads = 0;
    const askedPages: number[] = [];
    stubNetwork((request, path) => {
      if (path === API_PATHS.auth.methods) return success(AUTH_DISCOVERY);
      if (path === '/api/roles') return success({ roles: [], total: 0, page: 1, pages: 1 });
      if (path !== '/api/admin/users') return success({});
      const requestedPage = pageFrom(request);
      askedPages.push(requestedPage);
      if (phase === 'shrink' && requestedPage === 3) {
        return new Promise<Response>((resolve) => {
          releaseShrink = resolve;
        });
      }
      if (phase === 'grow' && requestedPage === 2) {
        return new Promise<Response>((resolve) => {
          releaseGrowth = resolve;
        });
      }
      if (phase === 'grow' && requestedPage === 3) pageThreeGrowthReads += 1;
      return pageResult(requestedPage, phase === 'shrink' ? 2 : 3, phase);
    });

    const page = await renderForm(
      locale,
      <UsersPage />,
      storeSignedInAs('admin', Object.values(USER_PERMISSIONS)),
    );
    const pageInfo = (current: number, total: number) =>
      page.format(PAGE_INFO, { page: current, totalPages: total });

    await screen.findByTestId('user-card-page-1-initial');
    fireEvent.click(screen.getByTestId('pagination-next'));
    await screen.findByTestId('user-card-page-2-initial');
    fireEvent.click(screen.getByTestId('pagination-next'));
    await screen.findByTestId('user-card-page-3-initial');

    phase = 'shrink';
    await act(async () => {
      page.store.dispatch(baseApi.util.invalidateTags(['User']));
    });
    await waitFor(() => expect(releaseShrink).toBeDefined());
    await act(async () => releaseShrink?.(pageResult(3, 2, 'shrunk')));
    await screen.findByTestId('user-card-page-2-shrink');
    await waitFor(() => expect(askedPages.filter((value) => value === 2)).toHaveLength(2));
    expect(screen.getByText(pageInfo(2, 2))).not.toBeNull();

    const growthStart = askedPages.length;
    phase = 'grow';
    await act(async () => {
      page.store.dispatch(baseApi.util.invalidateTags(['User']));
    });
    await waitFor(() => expect(releaseGrowth).toBeDefined());
    await act(async () => releaseGrowth?.(pageResult(2, 3, 'grown')));
    await screen.findByTestId('user-card-page-2-grown');
    await waitFor(() => expect(screen.getByText(pageInfo(2, 3))).not.toBeNull());

    expect(pageThreeGrowthReads).toBe(0);
    expect(askedPages.slice(growthStart)).toEqual([2]);
  });
});
