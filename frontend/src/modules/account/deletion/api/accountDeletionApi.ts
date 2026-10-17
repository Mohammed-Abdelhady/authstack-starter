import { API_PATHS, type AccountDeletionResult } from '@app/sdk';
import { staffRequest } from '@/modules/auth/api/staffRequest';
import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccessOrUnknownOutcome } from '@/store/api/invalidateOnSuccess';

/**
 * A person deleting their own account. The deletion ends every session, this
 * browser's too, so a success or a lost answer refetches the signed-in user
 * and the app follows the session that is gone.
 */
export const accountDeletionApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    deleteOwnAccount: builder.mutation<AccountDeletionResult, void>({
      queryFn: (...args) =>
        staffRequest<AccountDeletionResult>(
          { url: API_PATHS.accountDeletion.account, method: 'DELETE', body: {} },
          args[3],
        ),
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(['Auth', 'User']),
    }),
  }),
});

export const { useDeleteOwnAccountMutation } = accountDeletionApi;
