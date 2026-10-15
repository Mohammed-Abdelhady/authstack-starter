import { HTTP_METHOD } from '../constants';
import { ApiError } from '../errors';
import { HTTP_STATUS_NO_CONTENT, SERVER_ERROR_STATUS_MIN } from '../browser-transport/constants';
import { UnknownOutcomeError } from '../browser-transport/errors';
import { unwrapEnvelope } from '../envelope';
import { createOperationHandle } from '../browser-transport/operations';
import { unwrapSessionList } from '../sessions';
import { unwrapObject } from '../shapes';
import type { TransportSignal } from '../transport';
import type { AreaCall, AreaOptions, AreaSenders } from './shared';
import { ADMIN_PATHS, withQuery } from './admin/paths';
import type { AdminCreateOptions, AdminSessionList, ApiClientAdmin } from './admin/types';

export { ADMIN_PATHS } from './admin/paths';
export type * from './admin/types';

type WriteCall<TSignal extends TransportSignal> = AreaCall<TSignal> & { operationKey?: string };

interface AdminSenders<TSignal extends TransportSignal> extends AreaSenders<TSignal> {
  write<T extends object>(call: WriteCall<TSignal>, options: AreaOptions<TSignal>): Promise<T>;
  writeNoContent(call: WriteCall<TSignal>, options: AreaOptions<TSignal>): Promise<void>;
}

/** A 5xx answer to a write can follow its commit, so it is an unknown outcome, not a refusal. */
async function settleWrite<T>(operationKey: string | undefined, write: () => Promise<T>) {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ApiError && error.status >= SERVER_ERROR_STATUS_MIN) {
      throw new UnknownOutcomeError(operationKey, { cause: error, status: error.status });
    }
    throw error;
  }
}

function withWriters<TSignal extends TransportSignal>(
  senders: AreaSenders<TSignal>,
): AdminSenders<TSignal> {
  return {
    ...senders,
    write: <T extends object>(call: WriteCall<TSignal>, options: AreaOptions<TSignal>) =>
      settleWrite(call.operationKey, () => senders.sendObject<T>(call, options)),
    writeNoContent: (call, options) =>
      settleWrite(call.operationKey, async () => {
        const response = await senders.send(call, options);
        if (response.status !== HTTP_STATUS_NO_CONTENT) unwrapEnvelope(response);
      }),
  };
}

function createCall<TSignal extends TransportSignal>(
  path: string,
  body: object,
  options?: AdminCreateOptions<TSignal>,
): AreaCall<TSignal> & { operationKey: string } {
  const operation = options?.operation ?? createOperationHandle(options?.createOperationKey);
  return { method: HTTP_METHOD.POST, path, body, operationKey: operation.operationKey };
}

function createAccounts<TSignal extends TransportSignal>({
  sendObject,
  write,
  writeNoContent,
}: AdminSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['accounts'] {
  return {
    list: (query, options) =>
      sendObject(
        { method: HTTP_METHOD.GET, path: withQuery(ADMIN_PATHS.accounts, query) },
        options,
      ),
    create: (body, options) => write(createCall(ADMIN_PATHS.accounts, body, options), options),
    get: async (id, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: ADMIN_PATHS.account(id) }, options),
    update: async (id, body, options) =>
      write({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.account(id), body }, options),
    resendEmailChange: async (id, options) =>
      write({ method: HTTP_METHOD.POST, path: ADMIN_PATHS.resendEmailChange(id) }, options),
    updateStatus: async (id, body, options) =>
      write({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.accountStatus(id), body }, options),
    updateRole: async (id, body, options) =>
      write({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.accountRole(id), body }, options),
    delete: async (id, options) =>
      writeNoContent({ method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.account(id) }, options),
  };
}

function createRoles<TSignal extends TransportSignal>({
  sendObject,
  write,
  writeNoContent,
}: AdminSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['roles'] {
  return {
    list: (query, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: withQuery(ADMIN_PATHS.roles, query) }, options),
    get: async (id, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: ADMIN_PATHS.role(id) }, options),
    create: (body, options) => write(createCall(ADMIN_PATHS.roles, body, options), options),
    update: async (id, body, options) =>
      write({ method: HTTP_METHOD.PATCH, path: ADMIN_PATHS.role(id), body }, options),
    delete: async (id, options) =>
      writeNoContent({ method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.role(id) }, options),
  };
}

function createPermissions<TSignal extends TransportSignal>({
  sendObject,
  write,
}: AdminSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['permissions'] {
  return {
    list: async (id, options) =>
      sendObject({ method: HTTP_METHOD.GET, path: ADMIN_PATHS.permissions(id) }, options),
    grant: async (id, body, options) =>
      write({ method: HTTP_METHOD.POST, path: ADMIN_PATHS.permissions(id), body }, options),
    revoke: async (id, permission, options) =>
      write({ method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.permission(id, permission) }, options),
  };
}

function createSessions<TSignal extends TransportSignal>({
  send,
  write,
}: AdminSenders<TSignal>): ApiClientAdmin<TSignal>['admin']['sessions'] {
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
      write({ method: HTTP_METHOD.DELETE, path: ADMIN_PATHS.session(id, sessionId) }, options),
    revokeAll: async (id, options) =>
      write({ method: HTTP_METHOD.POST, path: ADMIN_PATHS.revokeAllSessions(id) }, options),
  };
}

export function createAdminArea<TSignal extends TransportSignal>(
  areaSenders: AreaSenders<TSignal>,
): ApiClientAdmin<TSignal> {
  const senders = withWriters(areaSenders);
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
