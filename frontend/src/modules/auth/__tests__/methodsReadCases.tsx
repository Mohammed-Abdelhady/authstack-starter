import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import { availability, heldAnswer, IDLE } from '@/tests/busyControls';
import { refusalWith, renderForm, stubNetwork, success } from '@/tests/serverRejectionHarness';
import { authMethodsApi } from '@/modules/auth/api/authMethodsApi';

const METHODS_PATH = '/api/auth/methods';
const ALL_OFF = { password: false, magicLink: false, twoFactor: false, passkeys: false, oauth: [] };

export interface MethodsReadSubject {
  /** The settings card, as the settings page mounts it. */
  card: ReactElement;
  /** The method the card belongs to. */
  method: 'password' | 'twoFactor' | 'passkeys';
  /** Catalogue key of the card's title. */
  titleKey: string;
  /** Catalogue key naming a button only the working card has. */
  workingButtonKey: string;
  /** Answers every request but the methods read. */
  otherReads: (path: string) => unknown;
}

function unreachable(): Response {
  throw new TypeError('Failed to fetch');
}

/** Answers each methods read with the next entry, repeating the last. */
function answerMethods(
  subject: MethodsReadSubject,
  ...answers: Array<() => Response | Promise<Response>>
) {
  let reads = 0;
  stubNetwork((_request, path) => {
    if (path !== METHODS_PATH) return success(subject.otherReads(path));
    const answer = answers[Math.min(reads, answers.length - 1)];
    reads += 1;
    return answer();
  });
  return () => reads;
}

/**
 * What a settings card does with the sign-in methods read: a failed read is a
 * failure with a retry, and only an answer that the method is off hides it.
 */
export function describeMethodsRead(name: string, subject: MethodsReadSubject) {
  const on = () => success({ methods: { ...ALL_OFF, [subject.method]: true } });
  const off = () => success({ methods: ALL_OFF });

  async function renderCard() {
    const view = await renderForm('en', subject.card);
    return {
      ...view,
      title: () => screen.queryByText(view.message(subject.titleKey)),
      workingButton: () =>
        screen.queryByRole('button', { name: view.message(subject.workingButtonKey) }),
      retryButton: () => screen.getByRole('button', { name: view.message('common.retry') }),
    };
  }

  describe(`${name} and the sign-in methods read`, () => {
    it('shows nothing when the server says the method is off', async () => {
      const reads = answerMethods(subject, off);
      const card = await renderCard();

      await waitFor(() => expect(reads()).toBe(1));
      await waitFor(() => expect(card.title()).toBeNull());
      expect(card.workingButton()).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('keeps a usable card during a held background methods refresh', async () => {
      const held = heldAnswer();
      const reads = answerMethods(subject, on, () => held.answer);
      const card = await renderCard();
      await waitFor(() => expect(card.workingButton()).not.toBeNull());

      const refresh = card.store.dispatch(
        authMethodsApi.endpoints.getAuthMethods.initiate(undefined, { forceRefetch: true }),
      );
      await waitFor(() => expect(reads()).toBe(2));
      expect(card.workingButton()).not.toBeNull();
      held.settle(on);
      await refresh;
      expect(card.workingButton()).not.toBeNull();
    });

    it.each([
      ['cannot be reached', unreachable],
      ['fails', () => refusalWith(500, ErrorCode.INTERNAL_ERROR)],
    ] as const)(
      'says the read failed, under its title, when the server %s',
      async (_case, answer) => {
        answerMethods(subject, answer);
        const card = await renderCard();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe(card.message('auth.methods.loadFailed'));
        expect(card.title()).not.toBeNull();
        expect(availability(card.retryButton())).toEqual(IDLE);
        expect(card.workingButton()).toBeNull();
      },
    );

    it('reads again on retry and shows the card when the read succeeds', async () => {
      const reads = answerMethods(subject, unreachable, on);
      const card = await renderCard();
      await screen.findByRole('alert');

      fireEvent.click(card.retryButton());

      await waitFor(() => expect(card.workingButton()).not.toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(reads()).toBe(2);
    });

    it('hides the card when the retry learns the method is off', async () => {
      const reads = answerMethods(subject, unreachable, off);
      const card = await renderCard();
      await screen.findByRole('alert');

      fireEvent.click(card.retryButton());

      await waitFor(() => expect(reads()).toBe(2));
      await waitFor(() => expect(card.title()).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps the failure and the focus on the retry when the read fails again', async () => {
      const held = heldAnswer();
      const reads = answerMethods(subject, unreachable, () => held.answer);
      const card = await renderCard();
      await screen.findByRole('alert');
      card.retryButton().focus();

      fireEvent.click(card.retryButton());

      await waitFor(() => expect(reads()).toBe(2));
      expect(card.workingButton()).toBeNull();
      held.settle(unreachable);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(card.message('auth.methods.loadFailed'));
      await waitFor(() => expect(document.activeElement).toBe(card.retryButton()));
    });
  });
}
