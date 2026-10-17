import { baseApi } from '@/store/api/baseApi';
import { API_PATHS, unwrapAuthMethodsBody, unwrapObjectBody } from '@app/sdk';
import type { AuthMethods } from '@app/sdk';

/**
 * Sign-in method discovery.
 *
 * Every auth screen reads this before it renders a form, so a deployment that
 * turned password sign-in off never shows a password field.
 */
interface AuthMethodsWithPolicy extends AuthMethods {
  audiencesEnabled?: boolean | undefined;
}

function methodsWithPolicy(response: unknown): AuthMethodsWithPolicy {
  const methods = unwrapAuthMethodsBody(response);
  const data = unwrapObjectBody<Record<string, unknown>>(response);
  const audiencesEnabled = data['audiencesEnabled'];
  return {
    ...methods,
    audiencesEnabled: typeof audiencesEnabled === 'boolean' ? audiencesEnabled : undefined,
  };
}

export const authMethodsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAuthMethods: builder.query<AuthMethodsWithPolicy, void>({
      query: () => ({ url: API_PATHS.auth.methods, method: 'GET' }),
      transformResponse: methodsWithPolicy,
      providesTags: ['AuthMethods'],
    }),
  }),
});

export const { useGetAuthMethodsQuery } = authMethodsApi;
