// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { API_PATHS } from '@app/sdk';
import { ErrorCode, ROLE_AUDIENCE, USER_PERMISSIONS } from '@app/core';
import { loadMessages } from '@/i18n/load-messages';
import { authMethodsApi } from '@/modules/auth/api/authMethodsApi';
import { heldAnswer } from '@/tests/busyControls';
import {
  formatter,
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { renderAdminCard, TARGET_USER } from './adminEmailConfirmationHarness';
import { stubListLayout } from './roleSelectorHarness';

const STAFF_TARGET = { ...TARGET_USER, role: 'editor', audience: ROLE_AUDIENCE.STAFF };
const METHODS = {
  password: false,
  magicLink: false,
  emailCode: false,
  twoFactor: false,
  passkeys: false,
  oauth: [],
};
const ROLES = { roles: [], total: 0, page: 1 };
const ASSIGN_ALL = [USER_PERMISSIONS.ASSIGN_ROLE_ALL];

let selectorName = '';
beforeAll(async () => {
  stubListLayout();
  selectorName = formatter('en', await loadMessages('en'))('permissions.userRole.selectorLabel', {
    role: STAFF_TARGET.role,
  });
});
registerFormTestLifecycle();

async function renderPolicy(options: {
  permissions: string[];
  audiencesEnabled?: unknown;
  unavailable?: boolean;
  methodPolicy?: boolean;
}) {
  stubNetwork((_request, path) =>
    path === API_PATHS.auth.methods
      ? options.unavailable
        ? refusalWith(503, ErrorCode.INTERNAL_ERROR)
        : success({
            methods: {
              ...METHODS,
              ...(options.methodPolicy === undefined
                ? {}
                : { audiencesEnabled: options.methodPolicy }),
            },
            audiencesEnabled: options.audiencesEnabled,
          })
      : success(ROLES),
  );
  const view = await renderAdminCard('en', STAFF_TARGET, options.permissions);
  const read = view.store.dispatch(authMethodsApi.endpoints.getAuthMethods.initiate());
  try {
    await act(async () => {
      if (options.unavailable) await expect(read.unwrap()).rejects.toMatchObject({ status: 503 });
      else await read.unwrap();
    });
  } finally {
    read.unsubscribe();
  }
  return view;
}

describe('Role assignment follows the advertised audience policy', () => {
  it.each([
    { audiencesEnabled: false, permissions: ASSIGN_ALL, selectable: true },
    { audiencesEnabled: true, permissions: ASSIGN_ALL, selectable: false },
    {
      audiencesEnabled: true,
      permissions: [USER_PERMISSIONS.ASSIGN_ROLE_STAFF],
      selectable: true,
    },
    {
      audiencesEnabled: false,
      permissions: [USER_PERMISSIONS.UPDATE_ALL],
      selectable: false,
    },
  ])('separates policy and assignment capability %#', async (settings) => {
    await renderPolicy(settings);

    if (settings.selectable)
      expect(screen.getByRole('combobox', { name: selectorName })).toBeDefined();
    else expect(screen.queryByRole('combobox', { name: selectorName })).toBeNull();
  });

  it.each([
    { audiencesEnabled: undefined },
    { audiencesEnabled: 'invalid' },
    { methodPolicy: false },
    { unavailable: true },
  ])('keeps assignment closed when policy is unknown %#', async (metadata) => {
    await renderPolicy({ ...metadata, permissions: ASSIGN_ALL });

    expect(screen.queryByRole('combobox', { name: selectorName })).toBeNull();
  });

  it('closes assignment when a real refetch fails despite cached successful metadata', async () => {
    let unavailable = false;
    stubNetwork((_request, path) =>
      path === API_PATHS.auth.methods
        ? unavailable
          ? refusalWith(503, ErrorCode.INTERNAL_ERROR)
          : success({ methods: METHODS, audiencesEnabled: false })
        : success(ROLES),
    );
    const view = await renderAdminCard('en', STAFF_TARGET, ASSIGN_ALL);
    expect(await screen.findByRole('combobox', { name: selectorName })).toBeDefined();
    unavailable = true;
    const read = view.store.dispatch(
      authMethodsApi.endpoints.getAuthMethods.initiate(undefined, { forceRefetch: true }),
    );
    try {
      await act(async () => {
        await expect(read.unwrap()).rejects.toMatchObject({ status: 503 });
      });
    } finally {
      read.unsubscribe();
    }

    expect(screen.queryByRole('combobox', { name: selectorName })).toBeNull();
  });

  it('keeps the selector closed until the policy response arrives', async () => {
    const held = heldAnswer();
    stubNetwork((_request, path) =>
      path === API_PATHS.auth.methods ? held.answer : success(ROLES),
    );
    await renderAdminCard('en', STAFF_TARGET, ASSIGN_ALL);

    expect(screen.queryByRole('combobox', { name: selectorName })).toBeNull();
    held.settle(() => success({ methods: METHODS, audiencesEnabled: false }));

    expect(await screen.findByRole('combobox', { name: selectorName })).toBeDefined();
  });
});
