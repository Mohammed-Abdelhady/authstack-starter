// feature:invitations:start
import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import { unwrapInvitationAcceptance } from '../invitations/parsers';
import type { TransportSignal } from '../transport';
import type { InvitationAcceptance } from '../types/invitations';
import type { AreaSenders } from './shared';

export const INVITATION_PATHS = { accept: '/api/auth/invitations/accept' } as const;

export interface ApiClientInvitations<TSignal extends TransportSignal = TransportSignal> {
  invitations: {
    accept(body: { token: string }, options?: CallOptions<TSignal>): Promise<InvitationAcceptance>;
  };
}

export function createInvitationsArea<TSignal extends TransportSignal>({
  send,
}: AreaSenders<TSignal>): ApiClientInvitations<TSignal> {
  return {
    invitations: {
      accept: async (body, options) =>
        unwrapInvitationAcceptance(
          await send({ method: HTTP_METHOD.POST, path: INVITATION_PATHS.accept, body }, options),
        ),
    },
  };
}
// feature:invitations:end
