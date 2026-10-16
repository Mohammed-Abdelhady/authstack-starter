import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import type { TransportSignal } from '../transport';
import type { NativeProviderCredential, User } from '../types';
import { pathSegment } from './path-segment';
import type { AreaSenders } from './shared';

export const PROVIDER_PATHS = {
  list: '/api/user/linked-providers',
  linkStart: '/api/user/providers/link/start',
  linkFinish: '/api/user/providers/link/finish',
  unlink: (provider: string) => `/api/user/unlink-provider/${pathSegment(provider, 'provider id')}`,
  setPrimary: '/api/user/set-primary-provider',
} as const;

export const PROVIDER_UNLINK_HINT = {
  ALLOWED: 'allowed',
  LAST_SIGN_IN_METHOD: 'last_sign_in_method',
  NOT_REMOVABLE: 'not_removable',
} as const;
export const PROVIDER_PRIMARY_HINT = {
  ALLOWED: 'allowed',
  NO_PROFILE_TO_SYNC: 'no_profile_to_sync',
} as const;
export const EMAIL_SIGN_IN_HINT = { USABLE: 'usable', SWITCHED_OFF: 'switched_off' } as const;
export type ProviderUnlinkHint = (typeof PROVIDER_UNLINK_HINT)[keyof typeof PROVIDER_UNLINK_HINT];
export type ProviderPrimaryHint =
  (typeof PROVIDER_PRIMARY_HINT)[keyof typeof PROVIDER_PRIMARY_HINT];
export type EmailSignInHint = (typeof EMAIL_SIGN_IN_HINT)[keyof typeof EMAIL_SIGN_IN_HINT];

export interface LinkedProviders {
  providers: string[];
  primaryProvider?: string;
  unlinkHints: Record<string, ProviderUnlinkHint>;
  primaryHints: Record<string, ProviderPrimaryHint>;
  emailSignIn?: EmailSignInHint;
}
export interface ProviderLinkStart {
  linkId: string;
  nonceDigest: string;
  state: string;
  expiresAt: string;
}
export interface ProviderLinkFinishInput {
  linkId: string;
  credential: NativeProviderCredential;
}
export interface ApiClientProviders<TSignal extends TransportSignal = TransportSignal> {
  providers: {
    list(options?: CallOptions<TSignal>): Promise<LinkedProviders>;
    linkStart(provider: string, options?: CallOptions<TSignal>): Promise<ProviderLinkStart>;
    linkFinish(input: ProviderLinkFinishInput, options?: CallOptions<TSignal>): Promise<User>;
    unlink(provider: string, options?: CallOptions<TSignal>): Promise<User>;
    setPrimary(provider: string, options?: CallOptions<TSignal>): Promise<User>;
  };
}

export function createProvidersArea<TSignal extends TransportSignal>({
  sendObject,
}: AreaSenders<TSignal>): ApiClientProviders<TSignal> {
  return {
    providers: {
      list: (options) =>
        sendObject({ method: HTTP_METHOD.GET, path: PROVIDER_PATHS.list }, options),
      linkStart: async (provider, options) =>
        sendObject(
          { method: HTTP_METHOD.POST, path: PROVIDER_PATHS.linkStart, body: { provider } },
          options,
        ),
      linkFinish: (input, options) =>
        sendObject(
          { method: HTTP_METHOD.POST, path: PROVIDER_PATHS.linkFinish, body: input },
          options,
        ),
      unlink: async (provider, options) =>
        sendObject({ method: HTTP_METHOD.DELETE, path: PROVIDER_PATHS.unlink(provider) }, options),
      setPrimary: async (provider, options) =>
        sendObject(
          { method: HTTP_METHOD.POST, path: PROVIDER_PATHS.setPrimary, body: { provider } },
          options,
        ),
    },
  };
}
