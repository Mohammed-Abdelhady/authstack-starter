import { exportPKCS8 } from 'jose'; // feature:apple
import type { OAuthProviderStrategy } from '../../../src/auth/oauth/oauth-provider.interface';
import { GoogleOAuthStrategy } from '../../../src/auth/oauth/strategies/google-oauth.strategy'; // feature:google
import { AppleOAuthStrategy } from '../../../src/auth/oauth/strategies/apple-oauth.strategy'; // feature:apple
import { FacebookOAuthStrategy } from '../../../src/auth/oauth/strategies/facebook-oauth.strategy'; // feature:facebook
import { configFor } from '../../../src/auth/oauth/strategies/oauth-strategy.harness-spec'; // feature:google,apple,facebook
import { createSigningKey } from '../../../src/auth/oauth/strategies/native-provider-proof.harness-spec'; // feature:apple
import { NATIVE_AUDIENCE } from '../../../src/auth/oauth/strategies/native-provider-proof.harness-spec'; // feature:google,apple,facebook
import type { NativeProviderSignInConfiguration } from '../../../src/config/types/native-application.type';

export interface NativeAttemptSdkProvider {
  signIn: NativeProviderSignInConfiguration;
  strategy: () => Promise<OAuthProviderStrategy>;
}

/** The SDK providers the project keeps; github signs in through the system browser only. */
export const NATIVE_ATTEMPT_SDK_PROVIDERS: NativeAttemptSdkProvider[] = [
  // feature:google:start
  {
    signIn: {
      id: 'google',
      mode: 'googleIdentityToken',
      webClientId: NATIVE_AUDIENCE,
    },
    strategy: () =>
      Promise.resolve(
        new GoogleOAuthStrategy(
          configFor('google', {
            clientId: 'web-client',
            clientSecret: 'test-secret',
          }),
        ),
      ),
  },
  // feature:google:end
  // feature:apple:start
  {
    signIn: {
      id: 'apple',
      mode: 'appleIdentityTokenAndCode',
      appId: NATIVE_AUDIENCE,
    },
    strategy: async () => {
      const signing = await createSigningKey('ES256', 'native-apple-signing');
      return new AppleOAuthStrategy(
        configFor('apple', {
          clientId: 'web-service',
          extra: {
            TEAM_ID: 'NATIVETEAM',
            KEY_ID: 'native-apple-signing',
            PRIVATE_KEY: await exportPKCS8(signing.privateKey),
          },
        }),
      );
    },
  },
  // feature:apple:end
  // feature:facebook:start
  {
    signIn: { id: 'facebook', mode: 'facebook', appId: NATIVE_AUDIENCE },
    strategy: () =>
      Promise.resolve(
        new FacebookOAuthStrategy(
          configFor('facebook', {
            clientId: NATIVE_AUDIENCE,
            clientSecret: 'test-secret',
          }),
        ),
      ),
  },
  // feature:facebook:end
];
