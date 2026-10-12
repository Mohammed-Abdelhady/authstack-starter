// @vitest-environment jsdom
import { availability, HELD } from '@/tests/busyControls';
import {
  change,
  fillActivation,
  navigation,
  submitActivation,
  SIGNED_IN_USER,
  NATIVE_CONTINUATION,
} from './registrationHarness';
import * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  descriptions,
  identitySuccess,
  refusal,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';
import { NativeAuthorizePanel } from '@/modules/auth/native/NativeAuthorizePanel';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('activation failures in %s', (locale) => {
  it('marks server fields, announces their errors and preserves typed values', async () => {
    stubNetwork(() => refusal(['email', 'code', 'name', 'password']));
    const form = await submitActivation(locale);
    for (const [testId, value] of [
      ['activate-email-input', 'layla@example.com'],
      ['activate-code-input', '000000'],
      ['activate-name-input', 'Layla Haddad'],
      ['activate-password-input', 'Passw0rdLayla'],
    ]) {
      const field = screen.getByTestId(testId);
      await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
      expect(descriptions(field)).toEqual([form.fieldMessage]);
      expect(field).toHaveProperty('value', value);
    }
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('activate-email-input')),
    );
    expect(screen.getByTestId('activate-confirm-password-input')).toHaveProperty(
      'value',
      'Passw0rdLayla',
    );
    expect(screen.getByTestId('activate-error').textContent).toBe(form.generalMessage);
  });

  it('keeps every field after a rejected code and preserves continuation on register again', async () => {
    navigation.search = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1';
    stubNetwork(() => refusalWith(400, ErrorCode.ACTIVATION_CODE_INVALID));
    const form = await submitActivation(locale);
    await waitFor(() =>
      expect(screen.getByTestId('activate-error').textContent).toBe(
        form.message('errors.codes.ACTIVATION_CODE_INVALID'),
      ),
    );
    for (const [testId, value] of [
      ['activate-email-input', 'layla@example.com'],
      ['activate-code-input', '000000'],
      ['activate-name-input', 'Layla Haddad'],
      ['activate-password-input', 'Passw0rdLayla'],
      ['activate-confirm-password-input', 'Passw0rdLayla'],
    ])
      expect(screen.getByTestId(testId)).toHaveProperty('value', value);
    expect(
      screen
        .getByRole('link', { name: form.message('auth.activate.registerAgain') })
        .getAttribute('href'),
    ).toBe('/auth/register?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1');
  });

  it('shows the existing expired view when the carried native transaction has expired', async () => {
    navigation.search = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1';
    stubNetwork((_, path) => {
      if (path === '/api/auth/identity') return identitySuccess(SIGNED_IN_USER);
      if (path === '/api/oauth/authorize/transaction/txn-1') {
        return refusalWith(400, ErrorCode.NATIVE_TRANSACTION_EXPIRED);
      }
      return success(
        path === '/api/auth/activate'
          ? { requiresTwoFactor: false, user: SIGNED_IN_USER }
          : SIGNED_IN_USER,
      );
    });
    const form = await submitActivation(locale);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(NATIVE_CONTINUATION));
    form.unmount();
    await renderForm(locale, <NativeAuthorizePanel transaction="txn-1" />, form.store);
    const title = await screen.findByRole('heading', {
      name: form.message('auth.nativeAuthorize.expiredTitle'),
    });
    expect(document.activeElement).toBe(title);
    expect(screen.getByTestId('native-authorize-expired').textContent).toContain(
      form.message('auth.nativeAuthorize.expiredBody'),
    );
    expect(screen.queryByTestId('native-authorize-approve')).toBeNull();
  });

  it('allows pasted code digits and makes one activation request while a write is pending', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = stubNetwork(async () => {
      await held;
      return success({ requiresTwoFactor: false, user: SIGNED_IN_USER });
    });
    await renderForm(locale, <ActivationForm />);
    fillActivation();
    change('activate-code-input', '12a34b56');
    expect(screen.getByTestId('activate-code-input')).toHaveProperty('value', '123456');
    fireEvent.submit(screen.getByTestId('activate-form'));
    fireEvent.submit(screen.getByTestId('activate-form'));
    try {
      await waitFor(() =>
        expect(availability(screen.getByTestId('activate-submit'))).toEqual(HELD),
      );
      expect(requests).toEqual(['POST /api/auth/activate']);
    } finally {
      release?.();
    }
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('resends to an address entered on direct activation without losing credentials', async () => {
    const bodies: unknown[] = [];
    stubNetwork(async (request) => {
      bodies.push(await request.json());
      return success({ email: 'layla@example.com' });
    });
    const form = await renderForm(locale, <ActivationForm />);
    fillActivation();
    fireEvent.click(screen.getByTestId('resend-button'));
    fireEvent.click(screen.getByTestId('resend-button'));
    await waitFor(() => expect(bodies).toEqual([{ email: 'layla@example.com' }]));
    await waitFor(() =>
      expect(form.successToasts()).toEqual([form.message('toast.success.resendSuccess')]),
    );
    expect(screen.getByTestId('activate-password-input')).toHaveProperty('value', 'Passw0rdLayla');
    expect(availability(screen.getByTestId('resend-button'))).toEqual(HELD);
  });
});
