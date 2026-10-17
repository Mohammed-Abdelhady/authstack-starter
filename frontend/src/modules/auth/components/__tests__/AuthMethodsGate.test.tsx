// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { availability, heldAnswer, IDLE } from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { AuthMethodsGate } from '../AuthMethodsGate';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const METHODS_READ = 'GET /api/auth/methods';
const PASSWORD_ONLY = {
  methods: { password: true, magicLink: false, twoFactor: false, passkeys: false, oauth: [] },
};
const NOTHING_ON = {
  methods: { password: false, magicLink: false, twoFactor: false, passkeys: false, oauth: [] },
};

registerFormTestLifecycle();

function unreachable(): Response {
  throw new TypeError('Failed to fetch');
}

/** Answers each read of the methods with the next entry, repeating the last. */
function answerMethods(...answers: Array<() => Response | Promise<Response>>) {
  let reads = 0;
  return stubNetwork(() => {
    const answer = answers[Math.min(reads, answers.length - 1)];
    reads += 1;
    return answer();
  });
}

async function renderGate(locale: AppLocale = 'en') {
  const view = await renderForm(
    locale,
    <AuthMethodsGate>
      {(methods) => <output data-testid="methods-known">{JSON.stringify(methods)}</output>}
    </AuthMethodsGate>,
  );
  const retryButton = () => screen.getByRole('button', { name: view.message('common.retry') });
  return { ...view, retryButton };
}

describe('the sign-in methods gate', () => {
  it('hands the methods to the screen once they are known', async () => {
    answerMethods(() => success(PASSWORD_ONLY));
    await renderGate();

    const shown = await screen.findByTestId('methods-known');
    expect(JSON.parse(shown.textContent ?? '')).toEqual({
      password: true,
      magicLink: false,
      emailCode: false,
      twoFactor: false,
      passkeys: false,
      oauth: [],
    });
  });

  // feature:passkeys:start
  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('hands passkeys-only methods to the screen in %s', async (locale) => {
    answerMethods(() =>
      success({
        methods: { password: false, magicLink: false, twoFactor: false, passkeys: true, oauth: [] },
      }),
    );
    await renderGate(locale);

    const shown = await screen.findByTestId('methods-known');
    expect(JSON.parse(shown.textContent ?? '')).toEqual({
      password: false,
      magicLink: false,
      emailCode: false,
      twoFactor: false,
      passkeys: true,
      oauth: [],
    });
    expect(screen.queryByTestId('auth-methods-empty')).toBeNull();
  });
  // feature:passkeys:end

  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('says so in %s when the server answers that every method is off', async (locale) => {
    answerMethods(() => success(NOTHING_ON));
    const gate = await renderGate(locale);

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe(gate.message('auth.methods.noneEnabled'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(gate.errorToasts()).toEqual([]);
  });

  it.each([
    ['the server cannot be reached', unreachable, 'toast.error.networkError'],
    [
      'the server fails',
      () => refusalWith(500, ErrorCode.INTERNAL_ERROR),
      'errors.codes.INTERNAL_ERROR',
    ],
  ] as const)('shows a failure with a retry when %s', async (_name, answer, toastKey) => {
    const requests = answerMethods(answer);
    const gate = await renderGate();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(gate.message('auth.methods.loadFailed'));
    expect(availability(gate.retryButton())).toEqual(IDLE);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByTestId('methods-known')).toBeNull();
    expect(requests).toEqual([METHODS_READ]);
    expect(gate.errorToasts()).toEqual([gate.message(toastKey)]);
  });

  it('reads again on retry and shows the methods when the read succeeds', async () => {
    const requests = answerMethods(unreachable, () => success(PASSWORD_ONLY));
    const gate = await renderGate();
    await screen.findByRole('alert');

    fireEvent.click(gate.retryButton());

    await screen.findByTestId('methods-known');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(requests).toEqual([METHODS_READ, METHODS_READ]);
  });

  it('keeps the failure and the focus on the retry when the read fails again', async () => {
    const held = heldAnswer();
    const requests = answerMethods(unreachable, () => held.answer);
    const gate = await renderGate();
    await screen.findByRole('alert');
    gate.retryButton().focus();

    fireEvent.click(gate.retryButton());

    await waitFor(() => expect(requests).toEqual([METHODS_READ, METHODS_READ]));
    expect(screen.getByTestId('auth-methods-loading')).toBeDefined();
    held.settle(unreachable);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(gate.message('auth.methods.loadFailed'));
    expect(document.activeElement).toBe(gate.retryButton());
  });
});
