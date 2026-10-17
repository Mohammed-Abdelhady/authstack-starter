import {
  unwrapProofCodeResultBody,
  unwrapFreshProofBody,
  unwrapBrowserPasskeyProofOptionsBody, // feature:passkeys
} from '@app/sdk';
// feature:passkeys:start
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
// feature:passkeys:end
import { baseApi } from '@/store/api/baseApi';
import { FRESH_PROOF_PATH } from '../constants/staff-operation';
import type { FreshProof } from '../types/staff-operation.types';
import { staffRequest } from './staffRequest';

export const freshProofApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    sendInvitationProofCode: builder.mutation<{ expiresInMinutes: number }, void>({
      query: () => ({ url: `${FRESH_PROOF_PATH}/code`, method: 'POST' }),
      transformResponse: unwrapProofCodeResultBody,
    }),
    verifyInvitationProofCode: builder.mutation<FreshProof, { code: string }>({
      queryFn: (body, _api, _extra, fetch) =>
        staffRequest<FreshProof>(
          { url: `${FRESH_PROOF_PATH}/code/verify`, method: 'POST', body },
          fetch,
          unwrapFreshProofBody,
        ),
    }),
    // feature:passkeys:start
    invitationProofOptions: builder.mutation<PublicKeyCredentialRequestOptionsJSON, void>({
      query: () => ({ url: `${FRESH_PROOF_PATH}/options`, method: 'POST' }),
      transformResponse: unwrapBrowserPasskeyProofOptionsBody,
    }),
    verifyInvitationPasskey: builder.mutation<FreshProof, AuthenticationResponseJSON>({
      queryFn: (body, _api, _extra, fetch) =>
        staffRequest<FreshProof>(
          { url: `${FRESH_PROOF_PATH}/verify`, method: 'POST', body },
          fetch,
          unwrapFreshProofBody,
        ),
    }),
    // feature:passkeys:end
  }),
});

export const {
  useSendInvitationProofCodeMutation,
  useVerifyInvitationProofCodeMutation,
  useInvitationProofOptionsMutation, // feature:passkeys
  useVerifyInvitationPasskeyMutation, // feature:passkeys
} = freshProofApi;
