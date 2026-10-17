// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, stubNetwork, success } from '@/tests/serverRejectionHarness';
import { adminContext } from '../../components/users/__tests__/adminEmailConfirmationHarness';
import { useUserActions } from '../useUserActions';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

describe('resend write concurrency', () => {
  it('sends one concurrent write and accepts another after the first settles', async () => {
    const releases: Array<(answer: Response) => void> = [];
    const requests = stubNetwork(() => new Promise<Response>((resolve) => releases.push(resolve)));
    const context = await adminContext('en');
    const hook = renderHook(useUserActions, { wrapper: context.wrapper });
    let first = Promise.resolve();
    let concurrent = Promise.resolve();
    act(() => {
      first = hook.result.current.handleResendEmailChange({
        userId: '507f1f77bcf86cd799439011',
        version: 0,
      });
      concurrent = hook.result.current.handleResendEmailChange({
        userId: '507f1f77bcf86cd799439011',
        version: 0,
      });
    });
    await waitFor(() => {
      expect(requests).toEqual([
        'POST /api/admin/users/507f1f77bcf86cd799439011/resend-email-change',
      ]);
    });
    await act(async () => {
      releases[0](success({ message: 'sent' }));
      await first;
      await concurrent;
    });
    let second = Promise.resolve();
    act(() => {
      second = hook.result.current.handleResendEmailChange({
        userId: '507f1f77bcf86cd799439011',
        version: 0,
      });
    });
    await waitFor(() => {
      expect(requests).toEqual([
        'POST /api/admin/users/507f1f77bcf86cd799439011/resend-email-change',
        'POST /api/admin/users/507f1f77bcf86cd799439011/resend-email-change',
      ]);
    });
    await act(async () => {
      releases[1](success({ message: 'sent' }));
      await second;
    });
  });
});
