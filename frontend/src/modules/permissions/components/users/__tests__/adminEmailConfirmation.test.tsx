// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode, USER_PERMISSIONS } from '@app/core';
import { refusalWith, registerFormTestLifecycle, success } from '@/tests/serverRejectionHarness';
import { renderAdminCard, stubCardNetwork, TARGET_USER } from './adminEmailConfirmationHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('admin email confirmation in %s', (locale) => {
  it('offers resend only while the account remains unverified', async () => {
    stubCardNetwork(() => success({}));
    const card = await renderAdminCard(locale);
    card.openMenu();
    expect(card.resendItem()).not.toBeNull();
    card.rerenderUser({ ...TARGET_USER, isVerified: true });
    expect(
      screen.queryByRole('menuitem', { name: card.message('users.actions.resendEmailChange') }),
    ).toBeNull();
  });

  it('hides resend from an actor without the update permission', async () => {
    const card = await renderAdminCard(locale, TARGET_USER, [USER_PERMISSIONS.READ_ALL]);
    expect(
      screen.queryByRole('button', { name: card.message('users.actions.menuLabel') }),
    ).toBeNull();
  });

  it('hides resend for a deleted account', async () => {
    stubCardNetwork(() => success({}));
    const card = await renderAdminCard(locale, { ...TARGET_USER, isDeleted: true });
    card.openMenu();
    expect(
      screen.queryByRole('menuitem', { name: card.message('users.actions.resendEmailChange') }),
    ).toBeNull();
  });

  it('posts the current account id without an email or body and announces success', async () => {
    const sent: Array<{ method: string; path: string; body: string }> = [];
    stubCardNetwork(async (request, path) => {
      sent.push({ method: request.method, path, body: await request.text() });
      return success({ message: 'Untranslated server acknowledgement' });
    });
    const card = await renderAdminCard(locale);
    card.openMenu();
    fireEvent.click(card.resendItem());
    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'POST',
          path: '/api/admin/users/507f1f77bcf86cd799439011/resend-email-change',
          body: '',
        },
      ]);
      expect(card.successToasts()).toEqual([
        card.message('users.actions.resendEmailChangeSuccess'),
      ]);
    });
    expect(card.errorToasts()).toEqual([]);
  });

  it.each([
    [429, ErrorCode.EMAIL_SEND_LIMIT_REACHED],
    [400, ErrorCode.EMAIL_SEND_FAILED],
    [403, ErrorCode.EMAIL_CHANGE_NOT_ALLOWED],
    [404, ErrorCode.USER_NOT_FOUND],
    [400, ErrorCode.CANNOT_MODIFY_SELF],
    [403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE],
    [403, ErrorCode.FORBIDDEN],
    [400, ErrorCode.INVALID_INPUT],
    [429, ErrorCode.RATE_LIMIT_EXCEEDED],
  ] as const)('announces catalogue refusal %s/%s with no success', async (status, code) => {
    stubCardNetwork(() => refusalWith(status, code));
    const card = await renderAdminCard(locale);
    card.openMenu();
    fireEvent.click(card.resendItem());
    await waitFor(() => {
      expect(card.errorToasts()).toEqual([card.message(`errors.codes.${code}`)]);
    });
    expect(card.successToasts()).toEqual([]);
  });

  it('announces a generic catalogue failure for an unknown server code', async () => {
    stubCardNetwork(() => refusalWith(500, 'UNRECOGNIZED_SERVER_FAILURE'));
    const card = await renderAdminCard(locale);
    card.openMenu();
    fireEvent.click(card.resendItem());
    await waitFor(() => {
      expect(card.errorToasts()).toEqual([card.message('toast.error.serverError')]);
    });
    expect(card.successToasts()).toEqual([]);
  });

  it('announces a catalogue network failure', async () => {
    stubCardNetwork(() => Promise.reject(new Error('offline')));
    const card = await renderAdminCard(locale);
    card.openMenu();
    fireEvent.click(card.resendItem());
    await waitFor(() => {
      expect(card.errorToasts()).toEqual([card.message('toast.error.networkError')]);
    });
    expect(card.successToasts()).toEqual([]);
  });

  it('disables actions while a resend is pending and enables them after settlement', async () => {
    let release: (answer: Response) => void = () => undefined;
    stubCardNetwork(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const card = await renderAdminCard(locale);
    card.openMenu();
    fireEvent.click(card.resendItem());
    const trigger = screen.getByRole('button', { name: card.message('users.actions.menuLabel') });
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(true));
    await act(async () => release(success({ message: 'sent' })));
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));
  });
});
