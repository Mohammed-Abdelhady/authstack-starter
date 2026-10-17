// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { availability, HELD, heldAnswer, IDLE } from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { EmailCodeForm } from '../EmailCodeForm';
import { NewAddressForm } from '../NewAddressForm';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
registerFormTestLifecycle();

const PENDING = 'next@example.test';
const EMAIL = '/api/user/email';
const CONFIRM = '/api/user/email/confirm';
const CODE = '123456';

const ACTIONS = [
  {
    first: 'cancel',
    initial: `DELETE ${EMAIL}`,
    next: `POST ${CONFIRM}`,
    status: 400,
    code: 'VALIDATION_ERROR',
  },
  {
    first: 'confirm',
    initial: `POST ${CONFIRM}`,
    next: `DELETE ${EMAIL}`,
    status: 503,
    code: 'AUTHORITY_UNAVAILABLE',
  },
] as const;

describe('exclusive own-email writes', () => {
  it.each(ACTIONS)('serializes $first against its opposite through refusal', async (action) => {
    const held = heldAnswer();
    const bodies: unknown[] = [];
    const requests = stubNetwork(async (request, path) => {
      if (request.method === 'POST') bodies.push(await request.json());
      return `${request.method} ${path}` === action.initial && requests.length === 1
        ? held.answer
        : success({ email: 'current@example.test', pendingEmail: PENDING });
    });
    const other = vi.fn();
    const { message } = await renderForm(
      'en',
      <EmailCodeForm pending={PENDING} onOtherAddress={other} />,
    );
    const input = screen.getByRole('textbox', { name: message('emailChange.code') });
    fireEvent.change(input, { target: { value: CODE } });
    const confirm = screen.getByRole('button', { name: message('emailChange.confirm') });
    const cancel = screen.getByRole('button', { name: message('emailChange.keepCurrent') });
    const first = action.first === 'cancel' ? cancel : confirm;
    const next = action.first === 'cancel' ? confirm : cancel;
    first.focus();
    fireEvent.click(first);
    try {
      await waitFor(() => expect(requests).toEqual([action.initial]));
      await act(async () => {
        fireEvent.click(next);
        fireEvent.click(first);
        fireEvent.submit(screen.getByTestId('email-change-code-form'));
        fireEvent.click(screen.getByRole('button', { name: message('emailChange.otherAddress') }));
      });
      expect(requests).toEqual([action.initial]);
      expect(other).not.toHaveBeenCalled();
      expect(availability(next)).toEqual(HELD);
      expect(first.getAttribute('aria-busy')).toBe('true');
      expect(next.getAttribute('aria-busy')).not.toBe('true');
      expect(document.activeElement).toBe(first);
      held.settle(() => refusalWith(action.status, action.code));
      await screen.findByTestId('email-change-code-error');
      await waitFor(() => expect(availability(next)).toEqual(IDLE));
      fireEvent.click(next);
      await waitFor(() => expect(requests).toEqual([action.initial, action.next]));
      expect(bodies).toEqual([{ code: CODE }]);
    } finally {
      await act(async () => held.settle(() => refusalWith(action.status, action.code)));
    }
  });

  it('holds new-address navigation without losing focus or duplicating its write', async () => {
    const held = heldAnswer();
    const requests = stubNetwork(() => held.answer);
    const cancel = vi.fn();
    const { message } = await renderForm(
      'en',
      <NewAddressForm current="current@example.test" onSent={vi.fn()} onCancel={cancel} />,
    );
    const input = screen.getByRole('textbox', { name: message('emailChange.newAddress') });
    fireEvent.change(input, { target: { value: PENDING } });
    const send = screen.getByRole('button', { name: message('emailChange.send') });
    const back = screen.getByRole('button', { name: message('emailChange.cancel') });
    send.focus();
    fireEvent.click(send);
    try {
      await waitFor(() => expect(requests).toEqual([`POST ${EMAIL}`]));
      await act(async () => {
        fireEvent.submit(screen.getByTestId('email-change-address-form'));
        fireEvent.click(back);
      });
      expect(requests).toEqual([`POST ${EMAIL}`]);
      expect(cancel).not.toHaveBeenCalled();
      expect(availability(back)).toEqual(HELD);
      expect(document.activeElement).toBe(send);
      held.settle(() => refusalWith(400, 'VALIDATION_ERROR'));
      await screen.findByTestId('email-change-address-error');
      await waitFor(() => expect(availability(back)).toEqual(IDLE));
      expect(input instanceof HTMLInputElement ? input.value : null).toBe(PENDING);
      expect(document.activeElement).toBe(send);
      fireEvent.click(back);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => held.settle(() => refusalWith(400, 'VALIDATION_ERROR')));
    }
  });
});
