// feature:invitations:start
import { NATIVE_AUTH_LIMITS } from '@app/core';
import { HTTP_STATUS_OK } from '../constants';
import { malformedResponse, unwrapEnvelope } from '../envelope';
import { rawSuccessObject } from '../raw';
import { requireArray, requireObject } from '../shapes';
import type { TransportResponse } from '../transport';
import type {
  AdminInvitation,
  AdminInvitationPage,
  InvitationAcceptance,
} from '../types/invitations';
import type { JsonFields } from '../types/json';
import { booleanValue, boundedLabel, email, isoDate } from '../native-auth/validation';
import { INVITATION_PURPOSES, INVITATION_STATUSES } from './constants';

function choice<const Choices extends readonly string[]>(
  value: unknown,
  allowed: Choices,
  context: { field: string; status: number },
): Choices[number] {
  const { field, status } = context;
  const selected = allowed.find((entry) => entry === value);
  if (selected === undefined) throw malformedResponse(status, `Invitation ${field} is invalid`);
  return selected;
}

function count(
  value: unknown,
  context: { field: string; status: number; minimum?: number },
): number {
  const { field, status, minimum = 0 } = context;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw malformedResponse(status, `Invitation ${field} is invalid`);
  }
  return value;
}

function text(value: unknown, field: string, status: number): string {
  if (typeof value !== 'string') throw malformedResponse(status, `Invitation ${field} is not text`);
  return value;
}

function invitationFrom(value: unknown, status: number): AdminInvitation {
  const row: JsonFields<AdminInvitation> = requireObject(value, 'invitation', status);
  return {
    id: text(row.id, 'id', status),
    email: email(row.email, 'email', status),
    role: text(row.role, 'role', status),
    status: choice(row.status, INVITATION_STATUSES, { field: 'status', status }),
    expiresAt: isoDate(row.expiresAt, 'expiresAt', status),
    createdAt: isoDate(row.createdAt, 'createdAt', status),
    ...(row.name === undefined
      ? {}
      : { name: boundedLabel(row.name, 'name', NATIVE_AUTH_LIMITS.NAME, status) }),
    ...(row.audience === undefined
      ? {}
      : {
          audience: choice(row.audience, ['customer', 'staff'] as const, {
            field: 'audience',
            status,
          }),
        }),
    ...(row.invitedBy === undefined ? {} : { invitedBy: text(row.invitedBy, 'invitedBy', status) }),
    ...(row.acceptedAt === undefined
      ? {}
      : { acceptedAt: isoDate(row.acceptedAt, 'acceptedAt', status) }),
    ...(row.revokedAt === undefined
      ? {}
      : { revokedAt: isoDate(row.revokedAt, 'revokedAt', status) }),
  };
}

export function unwrapAdminInvitation(response: TransportResponse): AdminInvitation {
  return invitationFrom(unwrapEnvelope<unknown>(response), response.status);
}

export function unwrapAdminInvitationPage(response: TransportResponse): AdminInvitationPage {
  const row: JsonFields<AdminInvitationPage> = requireObject(
    unwrapEnvelope<unknown>(response),
    'data',
    response.status,
  );
  return {
    invitations: requireArray(row.invitations, 'invitations', response.status).map((item) =>
      invitationFrom(item, response.status),
    ),
    total: count(row.total, { field: 'total', status: response.status }),
    page: count(row.page, { field: 'page', status: response.status, minimum: 1 }),
    pages: count(row.pages, { field: 'pages', status: response.status }),
  };
}

export function unwrapInvitationAcceptance(response: TransportResponse): InvitationAcceptance {
  const row: JsonFields<InvitationAcceptance> = rawSuccessObject(response);
  const user: JsonFields<InvitationAcceptance['user']> = requireObject(
    row.user,
    'user',
    response.status,
  );
  return {
    purpose: choice(row.purpose, INVITATION_PURPOSES, {
      field: 'purpose',
      status: response.status,
    }),
    enrolment: booleanValue(row.enrolment, 'enrolment', response.status),
    user: {
      id: text(user.id, 'user.id', response.status),
      email: email(user.email, 'user.email', response.status),
      name: boundedLabel(user.name, 'user.name', NATIVE_AUTH_LIMITS.NAME, response.status),
      role: text(user.role, 'user.role', response.status),
    },
  };
}

export function unwrapInvitationAcceptanceBody(body: unknown): InvitationAcceptance {
  return unwrapInvitationAcceptance({ status: HTTP_STATUS_OK, body });
}
// feature:invitations:end
