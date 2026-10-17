import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';
import type { OAuthStatePayload } from '../types/oauth-state.types';

/** The application whose cookie held the state, and the return base it names. */
export interface OAuthStateBinding {
  clientId: BrowserApplicationId;
  returnBase: string;
  legacy: boolean;
}

export function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Throws when a field is missing or the state names another application. */
export function readOAuthStatePayload(
  parsed: unknown,
  binding: OAuthStateBinding,
): OAuthStatePayload {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid payload');
  }
  const value = parsed as Record<string, unknown>;
  if (
    !isFilled(value.state) ||
    typeof value.redirect !== 'string' ||
    typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt)
  ) {
    throw new Error('missing fields');
  }
  if (binding.legacy) {
    if (value.clientId !== undefined || value.returnBase !== undefined) {
      throw new Error('modern state under a legacy cookie name');
    }
  } else if (
    value.clientId !== binding.clientId ||
    value.returnBase !== binding.returnBase
  ) {
    throw new Error('application binding mismatch');
  }
  const payload: OAuthStatePayload = {
    state: value.state,
    redirect: value.redirect,
    expiresAt: value.expiresAt,
    intent: value.intent === 'link' ? 'link' : 'login',
    clientId: binding.clientId,
    returnBase: binding.returnBase,
  };
  if (payload.intent === 'link') {
    if (!isFilled(value.linkUserId) || !isFilled(value.linkSessionId)) {
      throw new Error('missing link user or session');
    }
    payload.linkUserId = value.linkUserId;
    payload.linkSessionId = value.linkSessionId;
  }
  for (const field of ['codeVerifier', 'nonce'] as const) {
    if (value[field] === undefined) continue;
    if (!isFilled(value[field])) throw new Error('invalid proof field');
    payload[field] = value[field];
  }
  return payload;
}
