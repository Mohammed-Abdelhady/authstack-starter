import { HTTP_STATUS_OK } from '../../constants';
import { malformedResponse, unwrapEnvelope } from '../../envelope';
import { requireArray, requireObject } from '../../shapes';
import type { TransportResponse } from '../../transport';
import type { JsonFields } from '../../types/json';
import type { AdminPermissionList, AdminPermissionResult } from './types';

function permissionResult(response: TransportResponse): AdminPermissionResult {
  const row: JsonFields<AdminPermissionResult> = requireObject(
    unwrapEnvelope<unknown>(response),
    'permissions',
    response.status,
  );
  if (typeof row.userId !== 'string') throw malformedResponse(response.status, 'Missing user id');
  const permissions = requireArray(row.permissions, 'permissions', response.status).map((item) => {
    if (typeof item !== 'string') throw malformedResponse(response.status, 'Invalid permission');
    return item;
  });
  const version = row.version;
  if (
    version !== undefined &&
    (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
  ) {
    throw malformedResponse(response.status, 'Invalid account version');
  }
  return { userId: row.userId, permissions, ...(version === undefined ? {} : { version }) };
}

export function unwrapAdminPermissionResult(response: TransportResponse): AdminPermissionResult {
  return permissionResult(response);
}

export function unwrapAdminPermissionList(response: TransportResponse): AdminPermissionList {
  const result = permissionResult(response);
  const row: JsonFields<AdminPermissionList> = requireObject(
    unwrapEnvelope<unknown>(response),
    'permissions',
    response.status,
  );
  if (typeof row.role !== 'string') throw malformedResponse(response.status, 'Missing role');
  return { ...result, role: row.role };
}

export function unwrapAdminPermissionResultBody(body: unknown): AdminPermissionResult {
  return unwrapAdminPermissionResult({ status: HTTP_STATUS_OK, body });
}

export function unwrapAdminPermissionListBody(body: unknown): AdminPermissionList {
  return unwrapAdminPermissionList({ status: HTTP_STATUS_OK, body });
}
