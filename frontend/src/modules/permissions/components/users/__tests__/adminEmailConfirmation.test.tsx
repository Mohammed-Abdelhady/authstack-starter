// @vitest-environment jsdom
import { availability, HELD, IDLE } from '@/tests/busyControls';
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
    await renderAdminCard(locale, TARGET_USER, [USER_PERMISSIONS.READ_ALL]);
    expect(screen.queryByTestId(`user-actions-menu-${TARGET_USER._id}`)).toBeNull();
  });

  it('hides resend for a deleted account', async () => {
    stubCardNetwork(() => success({}));
    const card = await renderAdminCard(locale, { ...TARGET_USER, isDeleted: true });
    card.openMenu();
    expect(
      screen.queryByRole('menuitem', { name: card.message('users.actions.resendEmailChange') }),
    ).toBeNull();
  });

  it('keeps the confirmed address and verification state while an email change waits', async () => {
    stubCardNetwork(() => success({}));
    const pendingEmail = 'new.address@example.test';
    const user = { ...TARGET_USER, email: 'current@example.test', isVerified: true, pendingEmail };
    const card = await renderAdminCard(locale, user);

    expect(screen.getByTestId('user-card-email').textContent).toBe(user.email);
    expect(screen.getByTestId('user-card-pending-email').textContent).toContain(pendingEmail);
    expect(screen.getByTestId('user-verification-badge').textContent).toContain(
      card.message('common.status.verified'),
    );
  });

  it.each([undefined, null])(
    'shows no pending address when the API returns %s',
    async (pendingEmail) => {
      stubCardNetwork(() => success({}));
      await renderAdminCard(locale, { ...TARGET_USER, pendingEmail });

      expect(screen.queryByTestId('user-card-pending-email')).toBeNull();
      expect(screen.getByTestId('user-card-email').textContent).toBe(TARGET_USER.email);
    },
  );

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

  it('holds the actions button while a resend is pending and frees it after settlement', async () => {
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
    const trigger = screen.getByTestId(`user-actions-menu-${TARGET_USER._id}`);
    await waitFor(() => expect(availability(trigger)).toEqual(HELD));
    await act(async () => release(success({ message: 'sent' })));
    await waitFor(() => expect(availability(trigger)).toEqual(IDLE));
  });
});
