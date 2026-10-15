// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@app/core';
import { useUserActions } from '@/modules/permissions/hooks/useUserActions';
import { adminContext } from '@/modules/permissions/components/users/__tests__/adminEmailConfirmationHarness';
import {
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

describe('the role action consuming the server partial result', () => {
  it('completes on { id, role } and propagates a later refusal to its confirmation', async () => {
    let refuse = false;
    const requests = stubNetwork(() =>
      refuse ? refusalWith(403, ErrorCode.FORBIDDEN) : success({ id: 'user-2', role: 'admin' }),
    );
    const context = await adminContext('en');
    const hook = renderHook(useUserActions, { wrapper: context.wrapper });

    await act(async () => {
      await expect(
        hook.result.current.handleRoleChange('user-2', 'admin'),
      ).resolves.toBeUndefined();
    });
    refuse = true;
    await act(async () => {
      await expect(hook.result.current.handleRoleChange('user-2', 'admin')).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
    });

    expect(requests).toEqual([
      'PATCH /api/admin/users/user-2/role',
      'PATCH /api/admin/users/user-2/role',
    ]);
  });
});
