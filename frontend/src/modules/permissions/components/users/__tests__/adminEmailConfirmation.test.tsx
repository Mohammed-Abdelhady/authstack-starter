// @vitest-environment jsdom
import { availability, HELD, IDLE, heldAnswer } from '@/tests/busyControls';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ErrorCode, USER_PERMISSIONS } from '@app/core';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { refusalWith, registerFormTestLifecycle, success } from '@/tests/serverRejectionHarness';
import { renderAdminCard, stubCardNetwork, TARGET_USER } from './adminEmailConfirmationHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('admin email confirmation in %s', (locale) => {
  it('offers resend only for an actual pending address', async () => {
    stubCardNetwork(() => success({}));
    const card = await renderAdminCard(locale);
    card.openMenu();
    expect(card.resendItem()).not.toBeNull();
    card.rerenderUser({ ...TARGET_USER, isVerified: false });
    expect(card.resendItem()).not.toBeNull();

    const noPending = { ...TARGET_USER, isVerified: false };
    delete noPending.pendingEmail;
    card.rerenderUser(noPending);
    expect(
      screen.queryByRole('menuitem', { name: card.message('users.actions.resendEmailChange') }),
    ).toBeNull();
    for (const pendingEmail of [null, '', '   ']) {
      card.rerenderUser({ ...noPending, pendingEmail });
      expect(
        screen.queryByRole('menuitem', { name: card.message('users.actions.resendEmailChange') }),
      ).toBeNull();
    }
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

  it('resends for the observed account revision and announces success', async () => {
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
          body: JSON.stringify({ version: 0 }),
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

// A strict resend must use the observed zero version through proof and refuse stale retries.
describe('strict confirmation resend', () => {
  it.each(['current', 'target-changed', 'session-changed'] as const)(
    'settles proof only for the captured %s intent',
    async (mode) => {
      const verified = heldAnswer();
      const bodies: unknown[] = [];
      let verifies = 0;
      stubCardNetwork(async (request, path) => {
        if (path === '/api/admin/users/507f1f77bcf86cd799439011/resend-email-change') {
          bodies.push(await request.json());
          return bodies.length === 1
            ? refusalWith(401, ErrorCode.REAUTH_REQUIRED, {
                required: 'fresh_proof',
                methods: ['email-code'],
              })
            : success({ message: 'sent' });
        }
        if (path === '/api/auth/proof/code') return Response.json({ expiresInMinutes: 5 });
        if (path === '/api/auth/proof/code/verify') {
          verifies += 1;
          return verified.answer;
        }
        throw new Error('Unexpected strict resend request');
      });
      const card = await renderAdminCard('en');
      card.openMenu();
      fireEvent.click(card.resendItem());
      const proof = await screen.findByRole('dialog', {
        name: card.message('staffProof.proof.title'),
      });
      expect(card.successToasts()).toEqual([]);
      fireEvent.click(
        within(proof).getByRole('button', { name: card.message('staffProof.proof.send') }),
      );
      const code = await within(proof).findByRole('textbox', {
        name: card.message('staffProof.proof.code'),
      });
      fireEvent.change(code, { target: { value: '123456' } });
      const verifyButton = within(proof).getByRole('button', {
        name: card.message('staffProof.proof.verify'),
      });
      fireEvent.click(verifyButton);
      try {
        await waitFor(() => expect(verifies).toBe(1));
        if (mode === 'target-changed') card.rerenderUser({ ...TARGET_USER, version: 1 });
        if (mode === 'session-changed') {
          act(() =>
            card.store.dispatch(
              loginFulfilled({
                id: 'another-actor',
                email: 'other@example.test',
                name: 'Other',
                role: 'admin',
                permissions: [],
              }),
            ),
          );
        }
        await act(async () =>
          verified.settle(() => Response.json({ provedAt: '2026-11-01T00:00:00.000Z' })),
        );
        await waitFor(() =>
          expect(
            screen.queryByRole('dialog', { name: card.message('staffProof.proof.title') }),
          ).toBeNull(),
        );
        await waitFor(() =>
          expect(bodies).toEqual(
            mode === 'current' ? [{ version: 0 }, { version: 0 }] : [{ version: 0 }],
          ),
        );
        await waitFor(() => expect(card.successToasts()).toHaveLength(mode === 'current' ? 1 : 0));
      } finally {
        await act(async () =>
          verified.settle(() => Response.json({ provedAt: '2026-11-01T00:00:00.000Z' })),
        );
      }
    },
  );

  it('refuses an unobserved version before any resend', async () => {
    let sent = 0;
    stubCardNetwork(() => {
      sent += 1;
      return success({ message: 'sent' });
    });
    const unobserved = { ...TARGET_USER };
    delete unobserved.version;
    const card = await renderAdminCard('en', unobserved);
    card.openMenu();
    fireEvent.click(card.resendItem());
    await waitFor(() => expect(card.errorToasts()).toHaveLength(1));
    expect(sent).toBe(0);
    expect(card.successToasts()).toEqual([]);
  });
});
