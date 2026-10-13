import { AUTHORIZE_PATH } from '../constants';
import { NATIVE_SIGN_IN_LOCALE } from '../constants/native-sign-in-locale';
import type { AuthConfiguration } from '../types/auth';
import type { BrowserSignInOptions } from '../types/native-sign-in';

export function authorizationAddress(
  configuration: AuthConfiguration,
  challenge: string,
  state: string,
  options?: BrowserSignInOptions,
): string {
  const query = [
    ['response_type', 'code'],
    ['client_id', configuration.clientId],
    ['redirect_uri', configuration.redirectUri],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
    ['state', state],
    ['scope', configuration.scopes.join(' ')],
    ...(options?.providerId === undefined ? [] : [['provider_id', options.providerId]]),
    ...(options?.flow === undefined ? [] : [['flow', options.flow]]),
    ...(options?.locale === undefined ? [] : [['locale', options.locale]]),
  ];
  return `${configuration.serverBaseAddress}${AUTHORIZE_PATH}?${query
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`;
}

export function validBrowserSignInOptions(options?: BrowserSignInOptions): boolean {
  if (options === undefined) return true;
  if (
    options.providerId !== undefined &&
    (options.providerId.trim().length === 0 ||
      options.providerId.length > 128 ||
      hasControlCharacter(options.providerId))
  )
    return false;
  if (
    options.flow !== undefined &&
    options.flow !== 'signIn' &&
    options.flow !== 'registration' &&
    options.flow !== 'recovery'
  )
    return false;
  if (options.providerId !== undefined && options.flow !== undefined && options.flow !== 'signIn')
    return false;
  return (
    options.locale === undefined || Object.values(NATIVE_SIGN_IN_LOCALE).includes(options.locale)
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
