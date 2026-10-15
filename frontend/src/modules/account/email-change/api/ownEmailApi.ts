import { API_PATHS, type OwnEmail } from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccessOrUnknownOutcome } from '@/store/api/invalidateOnSuccess';

type Envelope<T> = { success: boolean; data: T };

/**
 * The person's own address and the change they asked for. A request and a
 * cancel answer the new state, which replaces the cached one; a confirm also
 * refetches the signed-in user, whose address it moved. The names carry
 * "own" because the public confirmation already has `confirmEmailChange`.
 */
export const ownEmailApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getOwnEmail: builder.query<OwnEmail, void>({
      query: () => ({ url: API_PATHS.account.email, method: 'GET' }),
      transformResponse: (response: Envelope<OwnEmail>) => response.data,
      providesTags: ['User'],
    }),
    requestOwnEmailChange: builder.mutation<OwnEmail, string>({
      query: (email) => ({ url: API_PATHS.account.email, method: 'POST', body: { email } }),
      transformResponse: (response: Envelope<OwnEmail>) => response.data,
      async onQueryStarted(_email, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(ownEmailApi.util.upsertQueryData('getOwnEmail', undefined, data));
        } catch {
          // The form shows the refusal; the cached state stays as it was.
        }
      },
    }),
    confirmOwnEmailChange: builder.mutation<OwnEmail, string>({
      query: (code) => ({ url: API_PATHS.account.confirmEmail, method: 'POST', body: { code } }),
      transformResponse: (response: Envelope<OwnEmail>) => response.data,
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(['Auth', 'User']),
    }),
    cancelOwnEmailChange: builder.mutation<OwnEmail, void>({
      query: () => ({ url: API_PATHS.account.email, method: 'DELETE' }),
      transformResponse: (response: Envelope<OwnEmail>) => response.data,
      async onQueryStarted(_argument, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(ownEmailApi.util.upsertQueryData('getOwnEmail', undefined, data));
        } catch {
          // The card shows the refusal; the cached state stays as it was.
        }
      },
    }),
  }),
});

export const {
  useGetOwnEmailQuery,
  useRequestOwnEmailChangeMutation,
  useConfirmOwnEmailChangeMutation,
  useCancelOwnEmailChangeMutation,
} = ownEmailApi;
