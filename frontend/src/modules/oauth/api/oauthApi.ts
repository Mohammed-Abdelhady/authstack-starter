import { baseApi } from '@/store/api/baseApi';
import { OAUTH_ROUTE_BASE, OAUTH_PROVIDERS_PATH } from '../constants';
import type { OAuthProviderSummary, OAuthProvidersResponse, OAuthStartRequest } from '../types';

export const oauthApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    startOAuth: builder.mutation<string, OAuthStartRequest>({
      query: ({ providerId, redirect, intent }) => ({
        url: `${OAUTH_ROUTE_BASE}/${encodeURIComponent(providerId)}/start`,
        method: 'POST',
        params: { redirect, intent },
      }),
      transformResponse: (response: { data: { url: string } }) => response.data.url,
    }),
    /**
     * Lists the providers that have credentials configured on the backend.
     */
    getEnabledProviders: builder.query<OAuthProviderSummary[], void>({
      query: () => ({
        url: OAUTH_PROVIDERS_PATH,
        method: 'GET',
      }),
      transformResponse: (response: { success: boolean; data: OAuthProvidersResponse }) =>
        response.data.providers,
    }),
  }),
});

export const { useGetEnabledProvidersQuery } = oauthApi;
