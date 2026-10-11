// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { RoleFilter } from '@/modules/users/components/RoleFilter';
import { availability, heldAnswer, HELD, IDLE } from '@/tests/busyControls';
import { listedRole, rolesPage } from '@/tests/roleList';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
} from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { CreateUserDialog } from '../CreateUserDialog';
import { UserRoleSelector } from '../UserRoleSelector';
import { stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLES = [ADMIN_LISTED, listedRole('user', 'User'), listedRole('editor', 'Editor')];
const refused = () => refusalWith(500, ErrorCode.INTERNAL_ERROR);

/**
 * Fails the first read of the roles list. Every later read waits for the test,
 * which answers it with the list or with another failure.
 */
function failThenHold() {
  let reads = 0;
  let held = heldAnswer();
  stubNetwork((request) => {
    reads += 1;
    if (reads === 1) return refused();
    const { answer } = held;
    return answer.then((respond) => (respond.ok ? rolesPage(request, ROLES) : respond));
  });
  return {
    reads: () => reads,
    succeed: () => held.settle(() => new Response(null, { status: 200 })),
    failAgain: () => {
      const { settle } = held;
      held = heldAnswer();
      settle(refused);
    },
  };
}

const CASES = [
  {
    name: 'a user card',
    page: <UserRoleSelector userId="user-1" currentRole="editor" />,
    retryId: 'user-role-list-error-user-1-retry',
    landingId: 'user-role-selector-user-1',
  },
  {
    name: 'the create user dialog',
    page: <CreateUserDialog open onOpenChange={() => undefined} />,
    retryId: 'create-user-roles-error-retry',
    landingId: 'create-user-role-select',
  },
] as const;

async function pressRetry(locale: AppLocale, { page, retryId }: (typeof CASES)[number]) {
  const server = failThenHold();
  await renderForm(locale, page, storeSignedInAs('admin'));
  const retry = await screen.findByTestId(retryId);
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(server.reads()).toBe(2));
  return { server, retry };
}

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after Retry on a role list that could not be read in %s', (locale) => {
  describe.each(CASES)('$name', (roleList) => {
    it('stays on Retry while it runs, then goes to the selector that takes its place', async () => {
      const { server, retry } = await pressRetry(locale, roleList);

      await waitFor(() => expect(availability(retry)).toEqual(HELD));
      expect(retry.getAttribute('aria-busy')).toBe('true');
      expect(document.activeElement).toBe(retry);

      server.succeed();

      const selector = await screen.findByTestId(roleList.landingId);
      await waitFor(() => expect(document.activeElement).toBe(selector));
      expect(selector.matches(':disabled')).toBe(false);
      expect(screen.queryByTestId(roleList.retryId)).toBeNull();
    });

    it('stays on Retry when the retry fails as well', async () => {
      const { server, retry } = await pressRetry(locale, roleList);
      await waitFor(() => expect(availability(retry)).toEqual(HELD));

      server.failAgain();

      await waitFor(() => expect(availability(retry)).toEqual(IDLE));
      expect(document.activeElement).toBe(retry);
      expect(retry.isConnected).toBe(true);
    });
  });

  it('goes to the search field of the role filter once its list was read', async () => {
    const server = failThenHold();
    await renderForm(
      locale,
      <RoleFilter value="all" onChange={() => undefined} />,
      storeSignedInAs('admin'),
    );
    // The filter reads every role for its label first: that is the read that fails here.
    fireEvent.click(screen.getByTestId('role-filter'));
    await waitFor(() => expect(server.reads()).toBe(2));
    server.failAgain();
    const retry = await screen.findByTestId('role-filter-retry');
    await waitFor(() => expect(availability(retry)).toEqual(IDLE));
    retry.focus();

    fireEvent.click(retry);
    await waitFor(() => expect(server.reads()).toBe(3));
    expect(availability(retry)).toEqual(HELD);
    expect(document.activeElement).toBe(retry);
    server.succeed();

    await screen.findByTestId('role-filter-option-editor');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('role-filter-search')),
    );
    expect(screen.queryByTestId('role-filter-retry')).toBeNull();
  });
});
