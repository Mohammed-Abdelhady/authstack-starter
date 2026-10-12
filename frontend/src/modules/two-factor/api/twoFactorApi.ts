import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccess } from '@/store/api/invalidateOnSuccess';
import type { LoginResponse } from '@/modules/auth/types/auth.types';
import { TWO_FACTOR_PATHS } from '../constants';
import type {
  DisableTwoFactorRequest,
  RecoveryCodes,
  TwoFactorAnswer,
  TwoFactorSetup,
} from '../types';

/**
 * TOTP second factor.
 *
 * Four routes manage the factor on a signed-in account. Verify is the odd one
 * out: it finishes a sign-in that was held for a code, so it runs without a
 * session and reads the challenge cookie instead.
 */
export const twoFactorApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    setupTwoFactor: builder.mutation<TwoFactorSetup, { password?: string }>({
      query: (body) => ({ url: TWO_FACTOR_PATHS.SETUP, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: TwoFactorSetup }) => response.data,
    }),

    confirmTwoFactor: builder.mutation<RecoveryCodes, { code: string }>({
      query: (body) => ({ url: TWO_FACTOR_PATHS.CONFIRM, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: RecoveryCodes }) => response.data,
      invalidatesTags: invalidateOnSuccess(['User']),
    }),

    disableTwoFactor: builder.mutation<{ message: string }, DisableTwoFactorRequest>({
      query: (body) => ({ url: TWO_FACTOR_PATHS.DISABLE, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: { message: string } }) =>
        response.data,
      invalidatesTags: invalidateOnSuccess(['User']),
    }),

    regenerateRecoveryCodes: builder.mutation<RecoveryCodes, { code: string; password?: string }>({
      query: (body) => ({ url: TWO_FACTOR_PATHS.REGENERATE, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: RecoveryCodes }) => response.data,
    }),

    verifyTwoFactor: builder.mutation<LoginResponse, TwoFactorAnswer>({
      query: (body) => ({ url: TWO_FACTOR_PATHS.VERIFY, method: 'POST', body }),
      transformResponse: (response: { success: boolean; data: LoginResponse }) => response.data,
      invalidatesTags: invalidateOnSuccess(['Auth', 'User']),
    }),
  }),
});

export const {
  useSetupTwoFactorMutation,
  useConfirmTwoFactorMutation,
  useDisableTwoFactorMutation,
  useRegenerateRecoveryCodesMutation,
  useVerifyTwoFactorMutation,
} = twoFactorApi;
