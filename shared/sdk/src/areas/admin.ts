import { HTTP_METHOD } from '../constants';
import { HTTP_STATUS_NO_CONTENT } from '../browser-transport/constants';
import { unwrapEnvelope } from '../envelope';
import { createOperationHandle } from '../browser-transport/operations';
import { unwrapSessionList } from '../sessions';
import { unwrapObject } from '../shapes';
import type { TransportSignal } from '../transport';
import type { AreaCall, AreaSenders } from './shared';
import { ADMIN_PATHS, withQuery } from './admin/paths';
import type { AdminCreateOptions, AdminSessionList, ApiClientAdmin } from './admin/types';

export { ADMIN_PATHS } from './admin/paths';
export type * from './admin/types';

function createCall<TSignal extends TransportSignal>(
  path: string,
  body: object,
  options?: AdminCreateOptions<TSignal>,
): AreaCall<TSignal> & { operationKey: string } {
  const operation = options?.operation ?? createOperationHandle(options?.createOperationKey);
  return { method: HTTP_METHOD.POST, path, body, operationKey: operation.operationKey };
}

function createAccounts<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['accounts'] {
  return {
    list: (query, options) =>
      sendObject(
        { method: HTTP_METHOD.GET, path: withQuery(ADMIN_PATHS.accounts, query) },
        options,
      ),
    create: (body, options) => sendObject(createCall(ADMIN_PATHS.accounts, body, options), options),
    get: async (id, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: ADMIN_PATHS.account(id) }, options),
    update: async (id, body, options) =>
      sendObject({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.account(id), body }, options),
    resendEmailChange: async (id, options) =>
      sendObject({ method: HTTP_METHOD.POST, path: ADMIN_PATHS.resendEmailChange(id) }, options),
    updateStatus: async (id, body, options) =>
      sendObject({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.accountStatus(id), body }, options),
    updateRole: async (id, body, options) =>
      sendObject({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.accountRole(id), body }, options),
    delete: async (id, options) => {
      const response = await send(
        { method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.account(id) },
        options,
      );
      if (response.status !== HTTP_STATUS_NO_CONTENT) unwrapEnvelope(response);
    },
  };
}

function createRoles<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['roles'] {
  return {
    list: (query, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: withQuery(ADMIN_PATHS.roles, query) }, options),
    get: async (id, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: ADMIN_PATHS.role(id) }, options),
    create: (body, options) => sendObject(createCall(ADMIN_PATHS.roles, body, options), options),
    update: async (id, body, options) =>
      sendObject({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.role(id), body }, options),
    delete: async (id, options) => {
      const response = await send(
        { method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.role(id) },
        options,
      );
      if (response.status !== HTTP_STATUS_NO_CONTENT) unwrapEnvelope(response);
    },
  };
}

function createPermissions<TSignal extends TransportSignal>({
  sendObject,
}: AreaSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['permissions'] {
  return {
    list: async (id, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: ADMIN_PATHS.permissions(id) }, options),
    grant: async (id, body, options) =>
      sendObject({ method: HTTP_METHOD.POST, path: ADMIN_PATHS.permissions(id), body }, options),
    revoke: async (id, permission, options) =>
      sendObject(
        { method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.permission(id, permission) },
        options,
      ),
  };
}

function createSessions<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['sessions'] {
  return {
    list: async (id, options) => {
      const response = await send(
        { method: HTTP_METHOD.GET, path: ADMIN_PATHS.sessions(id) },
        options,
      );
      const data = unwrapObject<AdminSessionList>(response);
      unwrapSessionList(response);
      return data;
    },
    revoke: async (id, sessionId, options) =>
      sendObject({ method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.session(id, sessionId) }, options),
    revokeAll: async (id, options) =>
      sendObject({ method: HTTP_METHOD.POST, path: ADMIN_PATHS.revokeAllSessions(id) }, options),
  };
}

export function createAdminArea<TSignal extends TransportSignal>(
  senders: AreaSenders<TSignal>,
): ApiClientAdmin<TSignal> {
  return {
    admin: {
      accounts: createAccounts(senders),
      permissions: createPermissions(senders),
      roles: createRoles(senders),
      sessions: createSessions(senders),
      activity: {
        list: (query, options) =>
          senders.sendObject(
            { method: HTTP_METHOD.GET, path: withQuery(ADMIN_PATHS.activity, query) },
            options,
          ),
      },
    },
  };
}
