// feature:invitations:start
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';
import { unwrapInvitationAcceptanceBody } from '../invitations/parsers';

const INVITATION = {
  id: 'invitation-1',
  email: 'member@example.com',
  role: 'user',
  status: 'pending',
  expiresAt: '2026-10-18T00:00:00.000Z',
  createdAt: '2026-10-17T00:00:00.000Z',
};
const ACCEPTANCE = {
  purpose: 'account',
  enrolment: true,
  user: { id: 'member-1', email: 'member@example.com', name: 'Member', role: 'user' },
};

function createReplayCases() {
  it('keeps create replay metadata, envelope reads and bodyless resend/revoke distinct', async () => {
    const transport = answering(201, { success: true, data: INVITATION });
    const { invitations } = createApiClient(transport).admin;
    const body = {
      email: 'member@example.com',
      role: 'user',
      locale: 'en',
      expectedRoleId: 'observed-role',
      expectedAudience: 'customer',
    } as const;
    const operation = { operationKey: 'resume-invitation' };
    expect(await invitations.create(body, { operation })).toEqual(INVITATION);
    await invitations.create(body, { operation });
    await invitations.resend('id/one');
    await invitations.revoke('id/one');
    expect(transport.sent).toEqual([
      {
        method: 'POST',
        path: '/api/admin/invitations',
        body: {
          email: 'member@example.com',
          role: 'user',
          locale: 'en',
          expectedRoleId: 'observed-role',
          expectedAudience: 'customer',
        },
        operationKey: 'resume-invitation',
      },
      {
        method: 'POST',
        path: '/api/admin/invitations',
        body: {
          email: 'member@example.com',
          role: 'user',
          locale: 'en',
          expectedRoleId: 'observed-role',
          expectedAudience: 'customer',
        },
        operationKey: 'resume-invitation',
      },
      { method: 'POST', path: '/api/admin/invitations/id%2Fone/resend' },
      { method: 'DELETE', path: '/api/admin/invitations/id%2Fone' },
    ]);
    const page = { invitations: [INVITATION], page: 1, pages: 1, total: 1 };
    const list = answering(200, { success: true, data: page });
    expect(
      await createApiClient(list).admin.invitations.list({ status: 'pending', page: 1, limit: 20 }),
    ).toEqual(page);
    expect(list.sent).toEqual([
      { method: 'GET', path: '/api/admin/invitations?status=pending&page=1&limit=20' },
    ]);
  });
}

function absentAudienceCases() {
  it('preserves explicit absent audience in the bound create and replay body', async () => {
    const transport = answering(201, { success: true, data: INVITATION });
    const { invitations } = createApiClient(transport).admin;
    const body = {
      email: 'member@example.com',
      role: 'user',
      expectedRoleId: 'unmapped-role',
      expectedAudience: null,
    };
    const options = { operation: { operationKey: 'unmapped-invitation' } };
    await invitations.create(body, options);
    await invitations.create(body, options);
    expect(transport.sent).toEqual([
      {
        method: 'POST',
        path: '/api/admin/invitations',
        body: {
          email: 'member@example.com',
          role: 'user',
          expectedRoleId: 'unmapped-role',
          expectedAudience: null,
        },
        operationKey: 'unmapped-invitation',
      },
      {
        method: 'POST',
        path: '/api/admin/invitations',
        body: {
          email: 'member@example.com',
          role: 'user',
          expectedRoleId: 'unmapped-role',
          expectedAudience: null,
        },
        operationKey: 'unmapped-invitation',
      },
    ]);
  });
}

describe('invitation wire contracts', () => {
  it('reads raw acceptance without inventing profile fields, and keeps refusals', async () => {
    const transport = answering(200, ACCEPTANCE);
    expect(await createApiClient(transport).invitations.accept({ token: 'one-use-token' })).toEqual(
      ACCEPTANCE,
    );
    expect(transport.sent).toEqual([
      { method: 'POST', path: '/api/auth/invitations/accept', body: { token: 'one-use-token' } },
    ]);
    expect(unwrapInvitationAcceptanceBody(ACCEPTANCE)).toEqual(ACCEPTANCE);
    expect(() => unwrapInvitationAcceptanceBody({ ...ACCEPTANCE, enrolment: null })).toThrow();
    expect(() => unwrapInvitationAcceptanceBody({ success: true, data: ACCEPTANCE })).toThrow();
    await expect(
      createApiClient(
        answering(400, {
          success: false,
          error: { code: 'INVITATION_INVALID', message: 'refused' },
        }),
      ).invitations.accept({ token: 'spent' }),
    ).rejects.toMatchObject({ status: 400, code: 'INVITATION_INVALID' });
  });

  createReplayCases();
  absentAudienceCases();

  it('does not send aborted writes and reports a post-write server failure as unknown', async () => {
    const transport = answering(503, {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'lost answer' },
    });
    const { invitations } = createApiClient(transport).admin;
    const body = { email: 'member@example.com', role: 'user' };
    await expect(
      invitations.create(body, {
        signal: { aborted: true },
        operation: { operationKey: 'unsent' },
      }),
    ).rejects.toMatchObject({ reason: 'aborted' });
    expect(transport.sent).toEqual([]);
    await expect(
      invitations.create(body, { operation: { operationKey: 'original' } }),
    ).rejects.toMatchObject({ name: 'UnknownOutcomeError', operationKey: 'original' });
    await expect(invitations.resend('invitation-1')).rejects.toMatchObject({
      name: 'UnknownOutcomeError',
    });
  });
});
// feature:invitations:end
