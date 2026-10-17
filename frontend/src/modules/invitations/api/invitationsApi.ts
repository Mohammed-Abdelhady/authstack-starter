import { staffRequest } from '@/modules/auth/api/staffRequest';
import { unwrapObjectBody, unwrapInvitationAcceptanceBody } from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccess } from '@/store/api/invalidateOnSuccess';
import {
  IDEMPOTENCY_HEADER,
  INVITATION_ACCEPT_PATH,
  INVITATIONS_PATH,
} from '../constants/invitations';
import type {
  AdminInvitation,
  InvitationAcceptance,
  InvitationPage,
  InvitationQuery,
  InvitationResend,
  InvitationSubmit,
} from '../types/invitation.types';

const INVITATION_TAG = 'Invitations' as const;
const unwrap = <T extends object>(response: unknown): T => unwrapObjectBody<T>(response);
export const invitationsApi = baseApi
  .enhanceEndpoints({ addTagTypes: [INVITATION_TAG] })
  .injectEndpoints({
    endpoints: (builder) => ({
      listInvitations: builder.query<InvitationPage, InvitationQuery>({
        query: ({ status, page, limit }) => ({
          url: INVITATIONS_PATH,
          params: { status, page, limit },
        }),
        transformResponse: unwrap<InvitationPage>,
        providesTags: [INVITATION_TAG],
        keepUnusedDataFor: 0,
      }),
      createInvitation: builder.mutation<AdminInvitation, InvitationSubmit>({
        queryFn: ({ body, idempotencyKey }, _api, _extra, fetch) =>
          staffRequest<AdminInvitation>(
            {
              url: INVITATIONS_PATH,
              method: 'POST',
              body,
              headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
            },
            fetch,
          ),
        invalidatesTags: invalidateOnSuccess([INVITATION_TAG]),
      }),
      resendInvitation: builder.mutation<AdminInvitation, InvitationResend>({
        queryFn: ({ id, idempotencyKey }, _api, _extra, fetch) =>
          staffRequest<AdminInvitation>(
            {
              url: `${INVITATIONS_PATH}/${encodeURIComponent(id)}/resend`,
              headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
              method: 'POST',
            },
            fetch,
          ),
        invalidatesTags: invalidateOnSuccess([INVITATION_TAG]),
      }),
      revokeInvitation: builder.mutation<void, string>({
        query: (id) => ({ url: `${INVITATIONS_PATH}/${encodeURIComponent(id)}`, method: 'DELETE' }),
        invalidatesTags: invalidateOnSuccess([INVITATION_TAG]),
      }),
      acceptInvitation: builder.mutation<InvitationAcceptance, { token: string }>({
        query: (body) => ({ url: INVITATION_ACCEPT_PATH, method: 'POST', body }),
        transformResponse: unwrapInvitationAcceptanceBody,
      }),
    }),
  });

export const {
  useListInvitationsQuery,
  useCreateInvitationMutation,
  useResendInvitationMutation,
  useRevokeInvitationMutation,
  useAcceptInvitationMutation,
} = invitationsApi;

export {
  useSendInvitationProofCodeMutation,
  useVerifyInvitationProofCodeMutation,
  useInvitationProofOptionsMutation, // feature:passkeys
  useVerifyInvitationPasskeyMutation, // feature:passkeys
} from '@/modules/auth/api/freshProofApi';
