import { exportPKCS8 } from 'jose';
import { AppleOAuthStrategy } from '../../../src/auth/oauth/strategies/apple-oauth.strategy';
import { configFor } from '../../../src/auth/oauth/strategies/oauth-strategy.harness-spec';
import { createSigningKey } from '../../../src/auth/oauth/strategies/native-provider-proof.harness-spec';
import { describeNativeProviderProof } from './native-provider-proof-contract';

describeNativeProviderProof({
  id: 'apple',
  mode: 'appleIdentityTokenAndCode',
  issuer: 'https://appleid.apple.com',
  jwks: 'https://appleid.apple.com/auth/keys',
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
});
