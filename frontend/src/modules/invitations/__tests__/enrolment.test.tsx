// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { EnrolmentPanel } from '../components/EnrolmentPanel';
import {
  identitySuccess,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

import { heldAnswer } from '@/tests/busyControls';

const browser = vi.hoisted(() => ({ startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: browser.startRegistration }));
registerFormTestLifecycle();

// Failure: enrollment calls the forbidden methods route before exposing registration, or duplicates a credential after identity refresh fails.
describe('invitation enrollment', () => {
  it('submits requested password proof and keeps it after a canceled prompt', async () => {
    browser.startRegistration
      .mockRejectedValueOnce(new DOMException('Canceled', 'NotAllowedError'))
      .mockResolvedValueOnce({ id: 'new-credential' });
    const proofs: unknown[] = [];
    const requests = stubNetwork(async (request, path) => {
      if (path === '/api/auth/passkeys/register/options') {
        const body: unknown = await request.json();
        proofs.push(body);
        if (!(body && typeof body === 'object' && 'password' in body))
          return refusalWith(401, 'REAUTH_REQUIRED', { required: 'password' });
        return success({ challenge: 'enrollment-challenge' });
      }
      if (path === '/api/auth/passkeys/register/verify') return success({ id: 'new-passkey' });
      if (path === '/api/auth/identity') return identitySuccess(null);
      throw new Error(`Enrollment endpoint refused: ${path}`);
    });
    const { message } = await renderForm('en', <EnrolmentPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: message('invitations.enrolment.register') }),
    );
    const password = await screen.findByLabelText(
      message('settings.passkeys.registration.password'),
    );
    fireEvent.change(password, { target: { value: 'ExistingPassword1!' } });
    fireEvent.click(
      screen.getByRole('button', { name: message('settings.passkeys.registration.submit') }),
    );
    await waitFor(() => expect(browser.startRegistration).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: message('settings.passkeys.registration.submit') })
          .getAttribute('aria-busy'),
      ).not.toBe('true'),
    );
    expect(password instanceof HTMLInputElement ? password.value : undefined).toBe(
      'ExistingPassword1!',
    );
    fireEvent.click(
      screen.getByRole('button', { name: message('settings.passkeys.registration.submit') }),
    );
    await waitFor(() => expect(requests).toContain('POST /api/auth/passkeys/register/verify'));
    expect(proofs).toEqual([
      {},
      { password: 'ExistingPassword1!' },
      { password: 'ExistingPassword1!' },
    ]);
  });

  it('registers through permitted endpoints and retries identity without registering again', async () => {
    browser.startRegistration.mockResolvedValue({ id: 'new-credential' });
    const bodies: unknown[] = [];
    const requests = stubNetwork(async (request, path) => {
      if (path === '/api/auth/passkeys/register/options')
        return success({ challenge: 'enrollment-challenge' });
      if (path === '/api/auth/passkeys/register/verify') {
        bodies.push(await request.json());
        return success({
          id: 'new-passkey',
          name: 'Laptop',
          backedUp: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        });
      }
      if (path === '/api/auth/identity') return identitySuccess(null);
      throw new Error(`Enrollment endpoint refused: ${path}`);
    });
    const { message } = await renderForm('en', <EnrolmentPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: message('invitations.enrolment.register') }),
    );
    const retry = await screen.findByRole('button', {
      name: message('invitations.enrolment.continue'),
    });
    await waitFor(() => expect(retry.getAttribute('aria-busy')).not.toBe('true'));
    fireEvent.click(retry);
    await waitFor(() =>
      expect(requests.filter((request) => request === 'GET /api/auth/identity')).toHaveLength(2),
    );
    expect(requests).toEqual([
      'POST /api/auth/passkeys/register/options',
      'POST /api/auth/passkeys/register/verify',
      'GET /api/auth/identity',
      'GET /api/auth/identity',
    ]);
    expect(bodies).toEqual([
      { response: { id: 'new-credential' }, name: message('settings.passkeys.deviceNames.other') },
    ]);
  });
});

describe('enrollment busy ownership', () => {
  it('announces the held registration without starting another ceremony', async () => {
    const held = heldAnswer();
    const requests = stubNetwork(() => held.answer);
    const { message } = await renderForm('en', <EnrolmentPanel />);
    const register = screen.getByRole('button', {
      name: message('invitations.enrolment.register'),
    });
    fireEvent.click(register);
    try {
      await waitFor(() => expect(requests).toEqual(['POST /api/auth/passkeys/register/options']));
      expect(register.getAttribute('aria-busy')).toBe('true');
      fireEvent.click(register);
      expect(requests).toHaveLength(1);
      await act(async () => held.settle(() => refusalWith(503, 'AUTHORITY_UNAVAILABLE')));
      await waitFor(() => expect(register.getAttribute('aria-busy')).not.toBe('true'));
      expect(browser.startRegistration).not.toHaveBeenCalled();
    } finally {
      await act(async () => held.settle(() => refusalWith(503, 'AUTHORITY_UNAVAILABLE')));
    }
  });
});
