import { SUCCESS_STATUS_MAX, SUCCESS_STATUS_MIN } from './constants';
import { unwrapEnvelope, type JsonObject } from './envelope';
import { requireObject } from './shapes';
import type { TransportResponse } from './transport';

/** These routes return raw success objects and the normal application error envelope. */
export function rawSuccessObject(response: TransportResponse): JsonObject {
  if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
    return unwrapEnvelope<JsonObject>(response);
  }
  return requireObject(response.body, 'body', response.status);
}
