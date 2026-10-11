import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { NextIntlClientProvider } from 'next-intl';
import { fireEvent, render, screen } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import { vi } from 'vitest';
import { USER_PERMISSIONS } from '@app/core';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { loadMessages, type AppLocale } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { makeStore, stubNetwork, success, toastText } from '@/tests/serverRejectionHarness';
import { UserCard, type User } from '../UserCard';

export const TARGET_USER: User = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Leila Hassan',
  email: 'leila@example.com',
  role: 'user',
  isVerified: false,
  isDeleted: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const ROLE_LIST_PATH = '/api/roles';

/**
 * The card reads the role list to name the role it shows. This answers that
 * read with an empty list and hands every other request to `respond`.
 */
export function stubCardNetwork(
  respond: (request: Request, path: string) => Response | Promise<Response>,
): string[] {
  return stubNetwork((request, path) =>
    request.method === 'GET' && path === ROLE_LIST_PATH
      ? success({ roles: [], total: 0, page: 1 })
      : respond(request, path),
  );
}

export async function adminContext(
  locale: AppLocale,
  permissions: string[] = [USER_PERMISSIONS.UPDATE_ALL],
) {
  const store = makeStore();
  store.dispatch(
    loginFulfilled({
      id: 'actor-admin',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      permissions,
    }),
  );
  const messages = await loadMessages(locale);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </Provider>
  );
  const shown = (calls: unknown[][]) =>
    calls.map(([message]) => toastText(message, locale, messages));
  return {
    store,
    wrapper,
    message: (key: string) => lookupMessage(messages, key),
    errorToasts: () => shown(vi.mocked(sonnerToast.error).mock.calls),
    successToasts: () => shown(vi.mocked(sonnerToast.success).mock.calls),
  };
}

export async function renderAdminCard(
  locale: AppLocale,
  user = TARGET_USER,
  permissions?: string[],
) {
  const context = await adminContext(locale, permissions);
  const view = render(<UserCard user={user} />, { wrapper: context.wrapper });
  return {
    ...context,
    rerenderUser: (nextUser: User) => view.rerender(<UserCard user={nextUser} />),
    openMenu: () => {
      fireEvent.keyDown(
        screen.getByRole('button', { name: context.message('users.actions.menuLabel') }),
        { key: 'Enter' },
      );
    },
    resendItem: () =>
      screen.getByRole('menuitem', { name: context.message('users.actions.resendEmailChange') }),
  };
}
