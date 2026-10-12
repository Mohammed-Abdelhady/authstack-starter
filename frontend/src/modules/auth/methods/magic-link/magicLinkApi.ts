import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccess } from '@/store/api/invalidateOnSuccess';
import type { LoginResponse } from '@/modules/auth/types/auth.types';

const REQUEST_PATH = '/api/auth/magic-link/request';
const VERIFY_PATH = '/api/auth/magic-link/verify';

/** Address the request was made for. The reply says nothing about the account. */
export interface MagicLinkRequestResult {
  email: string;
}

/** The server asks before spending a forwarded link in another browser session. */
export interface MagicLinkConfirmationRequired {
  requiresConfirmation: true;
  email: string;
}

export type MagicLinkVerifyResponse = LoginResponse | MagicLinkConfirmationRequired;

/**
 * Passwordless sign-in by mailed link.
 *
 * Request answers the same way for an address with an account, an address
 * without one, and an address over its hourly cap, so nothing here can be used
 * to find out which addresses are registered.
 */
export const magicLinkApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    requestMagicLink: builder.mutation<
      MagicLinkRequestResult,
      { email: string; redirect?: string }
    >({
      query: (body) => ({ url: REQUEST_PATH, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: MagicLinkRequestResult }) =>
        response.data,
    }),

    verifyMagicLink: builder.mutation<MagicLinkVerifyResponse, { token: string; confirm?: true }>({
      query: (body) => ({ url: VERIFY_PATH, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: MagicLinkVerifyResponse }) =>
        response.data,
      invalidatesTags: (result, error, arg) =>
        result && 'user' in result && result.user !== null
          ? invalidateOnSuccess(['Auth', 'User'])(result, error, arg)
          : [],
    }),
  }),
});

export const { useRequestMagicLinkMutation, useVerifyMagicLinkMutation } = magicLinkApi;
