export interface GoogleResponseFields {
  type?: unknown;
  data?: unknown;
}

export interface GoogleCredentialFields {
  idToken?: unknown;
}

export interface AppleCredentialFields {
  state?: unknown;
  identityToken?: unknown;
  authorizationCode?: unknown;
}

export interface FacebookLoginFields {
  isCancelled?: unknown;
}

export interface FacebookTokenFields {
  authenticationToken?: unknown;
  nonce?: unknown;
  accessToken?: unknown;
  applicationID?: unknown;
}
