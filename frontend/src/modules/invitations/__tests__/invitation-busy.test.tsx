// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@app/core';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { availability, HELD, heldAnswer } from '@/tests/busyControls';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { InviteDialog } from '../components/InviteDialog';
import { InvitationsPanel } from '../components/InvitationsPanel';
import { FreshProofDialog } from '../components/FreshProofDialog';
import { ACTOR, ROLE, INVITATION } from './invitation-fixtures';
import { rolesApi } from '@/modules/roles/api/rolesApi';
import { IDEMPOTENCY_HEADER } from '../constants/invitations';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// feature:passkeys:start
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: browser.startAuthentication }));
// feature:passkeys:end
registerFormTestLifecycle();

const INVITATIONS = '/api/admin/invitations';
const SECOND = { ...INVITATION, id: 'invitation-2', email: 'other@example.test' };

function invitationPage() {
  return success({ invitations: [INVITATION, SECOND], total: 2, page: 1, pages: 1 });
}

function actorStore() {
  return storeSignedInAs('admin', ACTOR.permissions);
}

describe('invitation action busy ownership', () => {
  it('announces the held create and sends only one idempotent write', async () => {
    const held = heldAnswer();
    const requests = stubNetwork((_request, path) =>
      path === '/api/roles'
        ? success({ roles: [ROLE, ADMIN_LISTED], total: 2, page: 1, pages: 1 })
        : held.answer,
    );
    const { message } = await renderForm('en', <InviteDialog />, actorStore());
    fireEvent.click(screen.getByTestId('invitation-open-create'));
    const dialog = await screen.findByTestId('invitation-create-dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: message('invitations.email') }), {
      target: { value: 'next@example.test' },
    });
    const submit = within(dialog).getByRole('button', { name: message('invitations.invite') });
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    fireEvent.click(submit);
    try {
      await waitFor(() => expect(requests).toContain(`POST ${INVITATIONS}`));
      expect(submit.getAttribute('aria-busy')).toBe('true');
      fireEvent.click(submit);
      fireEvent.submit(screen.getByTestId('invitation-create-form'));
      expect(requests.filter((request) => request === `POST ${INVITATIONS}`)).toHaveLength(1);
      await act(async () => held.settle(() => refusalWith(400, 'VALIDATION_ERROR')));
      await waitFor(() => expect(submit.getAttribute('aria-busy')).not.toBe('true'));
    } finally {
      await act(async () => held.settle(() => refusalWith(400, 'VALIDATION_ERROR')));
    }
  });

  it('announces only the row whose real resend is held', async () => {
    const held = heldAnswer();
    const requests = stubNetwork((request) =>
      request.method === 'GET' ? invitationPage() : held.answer,
    );
    await renderForm('en', <InvitationsPanel />, actorStore());
    const send = await screen.findByTestId('invitation-resend-invitation-1');
    const sibling = screen.getByTestId('invitation-resend-invitation-2');
    fireEvent.click(send);
    try {
      await waitFor(() => expect(requests).toContain(`POST ${INVITATIONS}/invitation-1/resend`));
      expect(send.getAttribute('aria-busy')).toBe('true');
      expect(sibling.getAttribute('aria-busy')).not.toBe('true');
      expect(availability(sibling)).toEqual(HELD);
      fireEvent.click(send);
      fireEvent.click(sibling);
      expect(requests.filter((request) => request.startsWith('POST '))).toEqual([
        `POST ${INVITATIONS}/invitation-1/resend`,
      ]);
    } finally {
      await act(async () => held.settle(() => refusalWith(400, 'VALIDATION_ERROR')));
    }
  });

  it('announces the held revocation without announcing its blocked cancel', async () => {
    const held = heldAnswer();
    const requests = stubNetwork((request) =>
      request.method === 'GET' ? invitationPage() : held.answer,
    );
    await renderForm('en', <InvitationsPanel />, actorStore());
    fireEvent.click(await screen.findByTestId('invitation-revoke-invitation-1'));
    const confirm = await screen.findByTestId('invitation-revoke-confirm');
    const cancel = screen.getByTestId('invitation-revoke-cancel');
    fireEvent.click(confirm);
    try {
      await waitFor(() => expect(requests).toContain(`DELETE ${INVITATIONS}/invitation-1`));
      expect(confirm.getAttribute('aria-busy')).toBe('true');
      expect(cancel.getAttribute('aria-busy')).not.toBe('true');
      fireEvent.click(confirm);
      fireEvent.click(cancel);
      expect(requests.filter((request) => request.startsWith('DELETE '))).toEqual([
        `DELETE ${INVITATIONS}/invitation-1`,
      ]);
      expect(screen.getByTestId('invitation-revoke-confirm')).toBe(confirm);
    } finally {
      await act(async () => held.settle(() => refusalWith(400, 'VALIDATION_ERROR')));
    }
  });

  // feature:passkeys:start
  it('announces only the held passkey proof action and never opens a second ceremony', async () => {
    const held = heldAnswer();
    browser.startAuthentication.mockResolvedValue({ id: 'proof-credential' });
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/proof/options'
        ? Response.json({ challenge: 'challenge', rpId: 'localhost', userVerification: 'required' })
        : held.answer,
    );
    const proved = vi.fn(async () => undefined);
    const { message } = await renderForm(
      'en',
      <FreshProofDialog methods={['passkey', 'email-code']} onProved={proved} onCancel={vi.fn()} />,
      actorStore(),
    );
    const passkey = screen.getByRole('button', { name: message('invitations.proof.passkey') });
    const send = screen.getByRole('button', { name: message('invitations.proof.send') });
    fireEvent.click(passkey);
    try {
      await waitFor(() => expect(requests).toContain('POST /api/auth/proof/verify'));
      expect(passkey.getAttribute('aria-busy')).toBe('true');
      expect(send.getAttribute('aria-busy')).not.toBe('true');
      fireEvent.click(passkey);
      fireEvent.click(send);
      expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
      expect(requests).toEqual(['POST /api/auth/proof/options', 'POST /api/auth/proof/verify']);
      expect(proved).not.toHaveBeenCalled();
    } finally {
      await act(async () => held.settle(() => refusalWith(400, 'PASSKEY_VERIFICATION_FAILED')));
    }
  });
  // feature:passkeys:end
});
describe('invitation proof busy ownership', () => {
  it('announces only the initiating proof action through real held requests', async () => {
    const sent = heldAnswer();
    const verified = heldAnswer();
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/proof/code' ? sent.answer : verified.answer,
    );
    const cancel = vi.fn();
    const proved = vi.fn(async () => undefined);
    const { message } = await renderForm(
      'en',
      <FreshProofDialog methods={['email-code']} onProved={proved} onCancel={cancel} />,
    );
    const send = screen.getByRole('button', { name: message('invitations.proof.send') });
    const back = screen.getByRole('button', { name: message('invitations.cancel') });
    fireEvent.click(send);
    try {
      await waitFor(() => expect(requests).toEqual(['POST /api/auth/proof/code']));
      expect(send.getAttribute('aria-busy')).toBe('true');
      expect(back.getAttribute('aria-busy')).not.toBe('true');
      expect(availability(back)).toEqual(HELD);
      fireEvent.click(back);
      expect(cancel).not.toHaveBeenCalled();
      await act(async () => sent.settle(() => Response.json({ expiresInMinutes: 5 })));
      const code = await screen.findByRole('textbox', {
        name: message('invitations.proof.code'),
      });
      fireEvent.change(code, { target: { value: '123456' } });
      const verify = screen.getByRole('button', { name: message('invitations.proof.verify') });
      fireEvent.click(verify);
      await waitFor(() =>
        expect(requests).toEqual(['POST /api/auth/proof/code', 'POST /api/auth/proof/code/verify']),
      );
      expect(verify.getAttribute('aria-busy')).toBe('true');
      expect(send.getAttribute('aria-busy')).not.toBe('true');
      fireEvent.click(send);
      fireEvent.click(back);
      expect(cancel).not.toHaveBeenCalled();
      expect(requests).toHaveLength(2);
      await act(async () => verified.settle(() => refusalWith(400, 'ACTIVATION_CODE_INVALID')));
      await waitFor(() => expect(availability(send)).not.toEqual(HELD));
      expect(proved).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        sent.settle(() => Response.json({ expiresInMinutes: 5 }));
        verified.settle(() => refusalWith(400, 'ACTIVATION_CODE_INVALID'));
      });
    }
  });
});

it('replays a lost invitation reply with its original role observation and key', async () => {
  let selectedRole = ROLE;
  const creates: { key: string | null; body: unknown }[] = [];
  stubNetwork(async (request, path) => {
    if (path === '/api/roles')
      return success({ roles: [selectedRole, ADMIN_LISTED], total: 2, page: 1, pages: 1 });
    if (path !== INVITATIONS) throw new Error('Unexpected invitation replay request');
    creates.push({ key: request.headers.get(IDEMPOTENCY_HEADER), body: await request.json() });
    if (creates.length === 1) throw new Error('Connection lost after write');
    return success(INVITATION);
  });
  const store = actorStore();
  const { message } = await renderForm('en', <InviteDialog />, store);
  fireEvent.click(screen.getByTestId('invitation-open-create'));
  const dialog = await screen.findByTestId('invitation-create-dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: message('invitations.email') }), {
    target: { value: 'next@example.test' },
  });
  const submit = within(dialog).getByRole('button', { name: message('invitations.invite') });
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(creates).toHaveLength(1));
  await waitFor(() => expect(submit.getAttribute('aria-busy')).not.toBe('true'));
  selectedRole = { ...ROLE, id: 'replacement-role-id' };
  const read = store.dispatch(
    rolesApi.endpoints.listAllRoles.initiate(undefined, { forceRefetch: true }),
  );
  try {
    await act(async () => {
      await read.unwrap();
    });
  } finally {
    read.unsubscribe();
  }
  fireEvent.click(submit);
  await waitFor(() => expect(creates).toHaveLength(2));
  const key = creates[0]?.key;
  expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(creates).toEqual([
    {
      key,
      body: {
        email: 'next@example.test',
        role: 'user',
        expectedRoleId: ROLE.id,
        expectedAudience: null,
      },
    },
    {
      key,
      body: {
        email: 'next@example.test',
        role: 'user',
        expectedRoleId: ROLE.id,
        expectedAudience: null,
      },
    },
  ]);
});

it('re-observes a refused role binding for the same draft while preserving its operation key', async () => {
  let selectedRole = ROLE;
  const creates: { key: string | null; body: unknown }[] = [];
  stubNetwork(async (request, path) => {
    if (path === '/api/roles')
      return success({ roles: [selectedRole, ADMIN_LISTED], total: 2, page: 1, pages: 1 });
    if (path !== INVITATIONS) throw new Error('Unexpected invitation replay request');
    creates.push({ key: request.headers.get(IDEMPOTENCY_HEADER), body: await request.json() });
    if (creates.length === 1) return refusalWith(409, ErrorCode.CONFLICT);
    return success(INVITATION);
  });
  const store = actorStore();
  const { message } = await renderForm('en', <InviteDialog />, store);
  fireEvent.click(screen.getByTestId('invitation-open-create'));
  const dialog = await screen.findByTestId('invitation-create-dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: message('invitations.email') }), {
    target: { value: 'next@example.test' },
  });
  const submit = within(dialog).getByRole('button', { name: message('invitations.invite') });
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(creates).toHaveLength(1));
  await waitFor(() => expect(submit.getAttribute('aria-busy')).not.toBe('true'));
  selectedRole = { ...ROLE, id: 'replacement-role-id' };
  const read = store.dispatch(
    rolesApi.endpoints.listAllRoles.initiate(undefined, { forceRefetch: true }),
  );
  try {
    await act(async () => {
      await read.unwrap();
    });
  } finally {
    read.unsubscribe();
  }
  fireEvent.click(submit);
  await waitFor(() => expect(creates).toHaveLength(2));
  const key = creates[0]?.key;
  expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(creates).toEqual([
    {
      key,
      body: {
        email: 'next@example.test',
        role: 'user',
        expectedRoleId: ROLE.id,
        expectedAudience: null,
      },
    },
    {
      key,
      body: {
        email: 'next@example.test',
        role: 'user',
        expectedRoleId: selectedRole.id,
        expectedAudience: null,
      },
    },
  ]);
});

it('does not submit an invitation without a usable role observation', async () => {
  let writes = 0;
  stubNetwork((request, path) => {
    if (path === '/api/roles')
      return success({ roles: [{ ...ROLE, id: '' }, ADMIN_LISTED], total: 2, page: 1, pages: 1 });
    if (request.method !== 'GET') writes += 1;
    return success(INVITATION);
  });
  const { message } = await renderForm('en', <InviteDialog />, actorStore());
  fireEvent.click(screen.getByTestId('invitation-open-create'));
  const dialog = await screen.findByTestId('invitation-create-dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: message('invitations.email') }), {
    target: { value: 'next@example.test' },
  });
  const submit = within(dialog).getByRole('button', { name: message('invitations.invite') });
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox').hasAttribute('disabled')).toBe(false),
  );
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(true));
  fireEvent.submit(screen.getByTestId('invitation-create-form'));
  expect(writes).toBe(0);
});
