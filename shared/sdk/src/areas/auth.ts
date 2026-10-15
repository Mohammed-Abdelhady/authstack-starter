import { unwrapAuthMethods } from '../auth-methods';
import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import { unwrapIdentity } from '../identity';
import type { TransportSignal } from '../transport';
import type { AuthMethods, Identity, MessageResult } from '../types';
import type { AreaSenders } from './shared';

export const AUTH_PATHS = {
  identity: '/api/auth/identity',
  methods: '/api/auth/methods',
  logout: '/api/auth/logout',
} as const;

export interface ApiClientAuth<TSignal extends TransportSignal = TransportSignal> {
  auth: {
    identity(options?: CallOptions<TSignal>): Promise<Identity>;
    methods(options?: CallOptions<TSignal>): Promise<AuthMethods>;
    /**
     * Signs out the session making the call: the cookie session in the
     * browser, the native token family on a bearer transport.
     */
    signOut(options?: CallOptions<TSignal>): Promise<MessageResult>;
  };
}

export function createAuthArea<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientAuth<TSignal> {
  return {
    auth: {
      identity: async (options) =>
        unwrapIdentity(await send({ method: HTTP_METHOD.GET, path: AUTH_PATHS.identity }, options)),
      methods: async (options) =>
        unwrapAuthMethods(
          await send({ method: HTTP_METHOD.GET, path: AUTH_PATHS.methods }, options),
        ),
      signOut: (options) =>
        sendObject({ method: HTTP_METHOD.POST, path: AUTH_PATHS.logout }, options),
    },
  };
}
