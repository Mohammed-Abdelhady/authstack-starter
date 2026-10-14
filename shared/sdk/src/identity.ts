import { HTTP_STATUS_OK } from './constants';
import { malformedResponse, unwrapEnvelope, unwrapEnvelopeBody } from './envelope';
import { requireArray, requireObject } from './shapes';
import type { TransportResponse } from './transport';
import type { Identity, User } from './types';
import type { JsonFields } from './types/json';

function stringField(value: unknown, name: string, status: number): string {
  if (typeof value !== 'string') {
    throw malformedResponse(status, `The response is malformed: ${name} is not text`);
  }
  return value;
}

function optionalProfileFields(
  user: JsonFields<User>,
): Pick<User, 'avatarUrl' | 'primaryProvider' | 'profileSyncedAt' | 'createdAt' | 'updatedAt'> {
  return {
    ...(typeof user.avatarUrl === 'string' ? { avatarUrl: user.avatarUrl } : {}),
    ...(typeof user.primaryProvider === 'string' ? { primaryProvider: user.primaryProvider } : {}),
    ...(typeof user.profileSyncedAt === 'string' ? { profileSyncedAt: user.profileSyncedAt } : {}),
    ...(typeof user.createdAt === 'string' ? { createdAt: user.createdAt } : {}),
    ...(typeof user.updatedAt === 'string' ? { updatedAt: user.updatedAt } : {}),
  };
}

function userFrom(value: unknown, status: number): User {
  const user: JsonFields<User> = requireObject(value, 'data.user', status);
  const permissions = requireArray(user.permissions, 'data.user.permissions', status);
  const linkedProviders = requireArray(user.linkedProviders, 'data.user.linkedProviders', status);
  const validPermissions = permissions.map((entry) =>
    stringField(entry, 'data.user.permissions item', status),
  );
  const validProviders = linkedProviders.map((entry) =>
    stringField(entry, 'data.user.linkedProviders item', status),
  );
  if (typeof user.isVerified !== 'boolean') {
    throw malformedResponse(
      status,
      'The response is malformed: data.user.isVerified is not boolean',
    );
  }
  // feature:totp:start
  if (typeof user.twoFactorEnabled !== 'boolean') {
    throw malformedResponse(
      status,
      'The response is malformed: data.user.twoFactorEnabled is not boolean',
    );
  }
  // feature:totp:end
  // feature:passkeys:start
  if (
    typeof user.passkeyCount !== 'number' ||
    !Number.isSafeInteger(user.passkeyCount) ||
    user.passkeyCount < 0
  ) {
    throw malformedResponse(status, 'The response is malformed: data.user.passkeyCount is invalid');
  }
  // feature:passkeys:end
  return {
    id: stringField(user.id, 'data.user.id', status),
    email: stringField(user.email, 'data.user.email', status),
    name: stringField(user.name, 'data.user.name', status),
    role: stringField(user.role, 'data.user.role', status),
    authProvider: stringField(user.authProvider, 'data.user.authProvider', status),
    permissions: validPermissions,
    linkedProviders: validProviders,
    isVerified: user.isVerified,
    // feature:totp:start
    twoFactorEnabled: user.twoFactorEnabled,
    // feature:totp:end
    // feature:passkeys:start
    passkeyCount: user.passkeyCount,
    // feature:passkeys:end
    ...optionalProfileFields(user),
  };
}

function identityFrom(value: unknown, status: number): Identity {
  const data: JsonFields<Identity> = requireObject(value, 'data', status);
  if (data.authenticated === false && data.user === null) {
    return { authenticated: false, user: null };
  }
  if (data.authenticated === true) {
    return { authenticated: true, user: userFrom(data.user, status) };
  }
  throw malformedResponse(status, 'The response is malformed: data identity state is inconsistent');
}

export function unwrapIdentity(response: TransportResponse): Identity {
  return identityFrom(unwrapEnvelope<unknown>(response), response.status);
}

export function unwrapIdentityBody(body: unknown): Identity {
  return identityFrom(unwrapEnvelopeBody<unknown>(body), HTTP_STATUS_OK);
}
