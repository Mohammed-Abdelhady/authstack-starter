import { API_PATHS, type AccountDeletionResult } from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccessOrUnknownOutcome } from '@/store/api/invalidateOnSuccess';

type Envelope<T> = { success: boolean; data: T };

/**
 * A person deleting their own account. The deletion ends every session, this
 * browser's too, so a success or a lost answer refetches the signed-in user
 * and the app follows the session that is gone.
 */
export const accountDeletionApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    deleteOwnAccount: builder.mutation<AccountDeletionResult, void>({
      query: () => ({ url: API_PATHS.accountDeletion.account, method: 'DELETE', body: {} }),
      transformResponse: (response: Envelope<AccountDeletionResult>) => response.data,
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(['Auth', 'User']),
    }),
  }),
});

export const { useDeleteOwnAccountMutation } = accountDeletionApi;
