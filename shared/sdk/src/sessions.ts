import { HTTP_STATUS_OK } from './constants';
import { unwrapEnvelope, unwrapEnvelopeBody } from './envelope';
import { requireArray, requireObject } from './shapes';
import type { TransportResponse } from './transport';
import type { Session, SessionList } from './types';
import type { JsonFields } from './types/json';

function toSessionList(data: unknown, status: number): SessionList {
  const list: JsonFields<SessionList> = requireObject(data, 'data', status);
  const sessions = requireArray(list.sessions, 'data.sessions', status) as Session[];
  return { sessions, total: typeof list.total === 'number' ? list.total : sessions.length };
}

/** The reply of GET /api/user/sessions, refused unless it carries a list of sessions. */
export function unwrapSessionList(response: TransportResponse): SessionList {
  return toSessionList(unwrapEnvelope<unknown>(response), response.status);
}

/** The same for a body whose response already passed as successful. */
export function unwrapSessionListBody(body: unknown): SessionList {
  return toSessionList(unwrapEnvelopeBody<unknown>(body), HTTP_STATUS_OK);
}
