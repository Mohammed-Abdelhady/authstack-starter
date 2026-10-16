import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { unwrapObjectBody } from '@app/sdk';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccess } from '@/store/api/invalidateOnSuccess';
import {
  FRESH_PROOF_PATH,
  IDEMPOTENCY_HEADER,
  INVITATION_ACCEPT_PATH,
  INVITATIONS_PATH,
} from '../constants/invitations';
import { invitationErrorKey } from '../utils/invitationErrors';
import type {
  AdminInvitation,
  FreshProof,
  InvitationAcceptance,
  InvitationPage,
  InvitationQuery,
  InvitationResend,
  InvitationSubmit,
} from '../types/invitation.types';

const INVITATION_TAG = 'Invitations' as const;
const unwrap = <T extends object>(response: unknown): T => unwrapObjectBody<T>(response);
type InvitationFetch = (
  args: string | FetchArgs,
) => ReturnType<BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError>>;

async function proofRequest<T extends object>(args: FetchArgs, fetch: InvitationFetch) {
  const result = await fetch(args);
  if (!result.error) return { data: unwrap<T>(result.data) };
  const error = result.error;
  const key = invitationErrorKey(error);
  // These 401s request proof within the live session, so they must not start a session reset.
  if (error.status === 401 && ['reauth', 'invalidCode', 'passkeyFailed'].includes(key)) {
    return { error: { status: 'CUSTOM_ERROR' as const, data: error.data, error: key } };
  }
  return { error };
}

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
          proofRequest<AdminInvitation>(
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
          proofRequest<AdminInvitation>(
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
        transformResponse: unwrap<InvitationAcceptance>,
      }),
      sendInvitationProofCode: builder.mutation<{ expiresInMinutes: number }, void>({
        query: () => ({ url: `${FRESH_PROOF_PATH}/code`, method: 'POST' }),
        transformResponse: unwrap<{ expiresInMinutes: number }>,
      }),
      verifyInvitationProofCode: builder.mutation<FreshProof, { code: string }>({
        queryFn: (body, _api, _extra, fetch) =>
          proofRequest<FreshProof>(
            { url: `${FRESH_PROOF_PATH}/code/verify`, method: 'POST', body },
            fetch,
          ),
      }),
      invitationProofOptions: builder.mutation<PublicKeyCredentialRequestOptionsJSON, void>({
        query: () => ({ url: `${FRESH_PROOF_PATH}/options`, method: 'POST' }),
        transformResponse: unwrap<PublicKeyCredentialRequestOptionsJSON>,
      }),
      verifyInvitationPasskey: builder.mutation<FreshProof, AuthenticationResponseJSON>({
        queryFn: (body, _api, _extra, fetch) =>
          proofRequest<FreshProof>(
            { url: `${FRESH_PROOF_PATH}/verify`, method: 'POST', body },
            fetch,
          ),
      }),
    }),
  });

export const {
  useListInvitationsQuery,
  useCreateInvitationMutation,
  useResendInvitationMutation,
  useRevokeInvitationMutation,
  useAcceptInvitationMutation,
  useSendInvitationProofCodeMutation,
  useVerifyInvitationProofCodeMutation,
  useInvitationProofOptionsMutation,
  useVerifyInvitationPasskeyMutation,
} = invitationsApi;
