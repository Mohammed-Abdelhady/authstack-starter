import { baseApi } from '@/store/api/baseApi';
import { API_PATHS, unwrapIdentityBody, unwrapObjectBody } from '@app/sdk';
import { invalidateOnSuccess } from '@/store/api/invalidateOnSuccess';
import type { Identity, MessageResult, UpdateProfileRequest, User } from '@app/sdk';
import {
  NATIVE_AUTHORIZE_APPROVE_ENDPOINT,
  NATIVE_AUTHORIZE_DENY_ENDPOINT,
  nativeAuthorizeTransactionEndpoint,
} from '../constants/nativeAuthorize';
import { CONFIRM_EMAIL_CHANGE_ENDPOINT } from '../constants/authMethods';
import type {
  EmailCodeRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  ActivateRequest,
  ActivateResponse,
  ResendActivationRequest,
  ResendActivationResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
} from '../types/auth.types';
import type {
  NativeAuthorizeActionRequest,
  NativeAuthorizeRedirect,
  NativeAuthorizeTransaction,
} from '../types/nativeAuthorize.types';

/**
 * Auth API slice with authentication endpoints
 * Extends the base API with auth-specific operations
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Login mutation
     * Authenticates user with email and password
     */
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/api/auth/login',
        method: 'POST',
        body: credentials,
      }),
      transformResponse: (response: { success: boolean; data: LoginResponse; message: string }) =>
        response.data,
      invalidatesTags: invalidateOnSuccess(['Auth', 'User']),
    }),

    /**
     * Logout mutation
     * Clears user session and auth cookies
     */
    logout: builder.mutation<MessageResult, void>({
      query: () => ({
        url: API_PATHS.auth.logout,
        method: 'POST',
      }),
      transformResponse: (response: unknown) => unwrapObjectBody<MessageResult>(response),
      // An unconfirmed sign-out leaves the session's fate unknown, so the reads
      // are asked again. A confirmed one clears the slice and the caller drops
      // the cache, so a refetch would only ask a closed session for its profile.
      invalidatesTags: (_result, error) =>
        error
          ? [
              'Auth',
              'User',
              'LinkedProviders', // feature:oauth-core
              'ProfileSync', // feature:oauth-core
              'AuthMethods',
              'Roles',
              'Permissions',
              'Sessions',
              'Passkeys', // feature:passkeys
            ]
          : [],
    }),

    /**
     * Optional session bootstrap. A missing session is a successful identity
     * answer with a null user, not a refused profile request.
     */
    getIdentity: builder.query<Identity, void>({
      query: () => API_PATHS.auth.identity,
      transformResponse: (response: unknown) => unwrapIdentityBody(response),
      providesTags: ['Auth', 'User'],
    }),

    /**
     * Get current user query
     * Fetches the currently authenticated user's data
     */
    getCurrentUser: builder.query<User, void>({
      query: () => API_PATHS.user.profile,
      transformResponse: (response: unknown) => unwrapObjectBody<User>(response),
      providesTags: ['User'],
    }),

    /**
     * Register mutation
     * Creates new user account and sends activation email
     */
    register: builder.mutation<RegisterResponse, RegisterRequest>({
      query: (data) => ({
        url: '/api/auth/register',
        method: 'POST',
        body: data,
      }),
    }),

    /**
     * Activate mutation
     * Confirms the account and returns its sign-in outcome
     */
    activate: builder.mutation<ActivateResponse, ActivateRequest>({
      query: (data) => ({
        url: '/api/auth/activate',
        method: 'POST',
        body: data,
      }),
      transformResponse: (response: {
        success: boolean;
        data: ActivateResponse;
        message: string;
      }) => response.data,
      invalidatesTags: (result, error, arg) =>
        result?.user ? invalidateOnSuccess(['Auth', 'User'])(result, error, arg) : [],
    }),

    confirmEmailChange: builder.mutation<MessageResult, EmailCodeRequest>({
      query: (body) => ({ url: CONFIRM_EMAIL_CHANGE_ENDPOINT, method: 'POST', body }),
      transformResponse: (response: unknown) => unwrapObjectBody<MessageResult>(response),
    }),

    /**
     * Resend activation code mutation
     * Sends a new activation code to the user's email
     */
    resendActivation: builder.mutation<ResendActivationResponse, ResendActivationRequest>({
      query: (data) => ({
        url: '/api/auth/resend-activation',
        method: 'POST',
        body: data,
      }),
    }),

    /**
     * Forgot password mutation
     * Sends password reset link to user's email
     */
    forgotPassword: builder.mutation<ForgotPasswordResponse, ForgotPasswordRequest>({
      query: (data) => ({
        url: '/api/auth/forgot-password',
        method: 'POST',
        body: data,
      }),
    }),

    /**
     * Reset password mutation
     * Resets user password with token from email
     */
    resetPassword: builder.mutation<ResetPasswordResponse, ResetPasswordRequest>({
      query: (data) => ({
        url: '/api/auth/reset-password',
        method: 'POST',
        body: data,
      }),
    }),

    /**
     * Change password mutation
     * Changes password for authenticated user
     * Invalidates all other sessions on success
     */
    changePassword: builder.mutation<
      { message: string },
      { currentPassword: string; newPassword: string }
    >({
      query: (data) => ({
        url: '/api/user/password',
        method: 'POST',
        body: data,
      }),
      transformResponse: (response: { success: boolean; data: { message: string } }) =>
        response.data,
      invalidatesTags: invalidateOnSuccess(['Sessions']),
    }),

    /**
     * Update profile mutation
     * Updates user profile information (name)
     */
    updateProfile: builder.mutation<User, UpdateProfileRequest>({
      query: (data) => ({
        url: API_PATHS.user.profile,
        method: 'PATCH',
        body: data,
      }),
      transformResponse: (response: unknown) => unwrapObjectBody<User>(response),
      invalidatesTags: invalidateOnSuccess(['User']),
    }),

    /**
     * Read a native authorize transaction.
     * Answers whether the signed-in browser may approve it, and withholds the
     * redirect address, the PKCE challenge and the state.
     */
    getNativeAuthorizeTransaction: builder.query<NativeAuthorizeTransaction, string>({
      query: (transactionId) => nativeAuthorizeTransactionEndpoint(transactionId),
      transformResponse: (response: { success: boolean; data: NativeAuthorizeTransaction }) =>
        response.data,
    }),

    /**
     * Approve a native authorize transaction.
     * Ends it once and answers with the redirect address carrying the code.
     */
    approveNativeAuthorize: builder.mutation<NativeAuthorizeRedirect, NativeAuthorizeActionRequest>(
      {
        query: (body) => ({
          url: NATIVE_AUTHORIZE_APPROVE_ENDPOINT,
          method: 'POST',
          body,
        }),
        transformResponse: (response: { success: boolean; data: NativeAuthorizeRedirect }) =>
          response.data,
      },
    ),

    /**
     * Deny a native authorize transaction.
     * Ends it once and answers with the redirect address carrying access_denied.
     */
    denyNativeAuthorize: builder.mutation<NativeAuthorizeRedirect, NativeAuthorizeActionRequest>({
      query: (body) => ({
        url: NATIVE_AUTHORIZE_DENY_ENDPOINT,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { success: boolean; data: NativeAuthorizeRedirect }) =>
        response.data,
    }),
  }),
});

// Export hooks for usage in components
export const {
  useLoginMutation,
  useLogoutMutation,
  useGetIdentityQuery,
  useGetCurrentUserQuery,
  useRegisterMutation,
  useActivateMutation,
  useConfirmEmailChangeMutation,
  useResendActivationMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useChangePasswordMutation,
  useUpdateProfileMutation,
  useGetNativeAuthorizeTransactionQuery,
  useApproveNativeAuthorizeMutation,
  useDenyNativeAuthorizeMutation,
} = authApi;
