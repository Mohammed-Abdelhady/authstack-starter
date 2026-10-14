import { FacebookOAuthStrategy } from '../../../src/auth/oauth/strategies/facebook-oauth.strategy';
import { configFor } from '../../../src/auth/oauth/strategies/oauth-strategy.harness-spec';
import { NATIVE_AUDIENCE } from '../../../src/auth/oauth/strategies/native-provider-proof.harness-spec';
import { describeNativeProviderProof } from './native-provider-proof-contract';

describeNativeProviderProof({
  id: 'facebook',
  mode: 'facebook',
  issuer: 'https://www.facebook.com',
  jwks: 'https://www.facebook.com/.well-known/oauth/openid/jwks/',
  strategy: () =>
    Promise.resolve(
      new FacebookOAuthStrategy(
        configFor('facebook', {
          clientId: NATIVE_AUDIENCE,
          clientSecret: 'test-secret',
        }),
      ),
    ),
});
