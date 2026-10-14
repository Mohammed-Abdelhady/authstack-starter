import { GoogleOAuthStrategy } from '../../../src/auth/oauth/strategies/google-oauth.strategy';
import { configFor } from '../../../src/auth/oauth/strategies/oauth-strategy.harness-spec';
import { describeNativeProviderProof } from './native-provider-proof-contract';
import { describeNativeProviderCreationGate } from './native-provider-creation-gate.harness-spec';

describeNativeProviderCreationGate();

describeNativeProviderProof({
  id: 'google',
  mode: 'googleIdentityToken',
  issuer: 'https://accounts.google.com',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  strategy: () =>
    Promise.resolve(
      new GoogleOAuthStrategy(
        configFor('google', {
          clientId: 'web-client',
          clientSecret: 'test-secret',
        }),
      ),
    ),
});
