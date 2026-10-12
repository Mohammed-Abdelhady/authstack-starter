export interface ValidatedNativeAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  requestedScopes: string[];
}
