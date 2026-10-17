import { ApiError } from '@app/sdk';
import { PROVIDER_REFUSAL } from '../constants/providers';
import type { MessageKey, Translate } from '../i18n';
import { toApiFailure } from './request-failure';
import { failureText } from './session-text';

const REFUSAL_TEXT = new Map<string, MessageKey>([
  [PROVIDER_REFUSAL.REAUTH, 'providers.reauth'],
  [PROVIDER_REFUSAL.ELSEWHERE, 'providers.elsewhere'],
  [PROVIDER_REFUSAL.LINKED, 'providers.alreadyLinked'],
  [PROVIDER_REFUSAL.EXPIRED, 'providers.expired'],
  [PROVIDER_REFUSAL.DISABLED, 'providers.disabled'],
  [PROVIDER_REFUSAL.LAST, 'providers.lastMethod'],
]);

export function providerFailure(t: Translate, error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  const key = code === undefined ? undefined : REFUSAL_TEXT.get(code);
  const messageKey: MessageKey = key ?? 'providers.failed';
  return {
    key: messageKey,
    description: key === undefined ? failureText(t, toApiFailure(error)) : undefined,
    signInAgain: code === PROVIDER_REFUSAL.REAUTH,
  };
}
