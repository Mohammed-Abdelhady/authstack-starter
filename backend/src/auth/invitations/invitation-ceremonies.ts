import { Injectable, OnModuleInit } from '@nestjs/common';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { BROWSER_APPLICATION_ROUTES } from '../../session/constants/browser-application-routes';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { hashToken } from '../../session/utils/hashing/token-hash';
import { INVITATION_MAX_TOKEN_LENGTH } from './constants/invitations';
import { InvitationStore } from './stores/invitation.store';

@Injectable()
export class InvitationCeremonies implements OnModuleInit {
  constructor(
    private readonly invitations: InvitationStore,
    private readonly runner: UnitOfWorkRunner,
    private readonly applications: BrowserApplications,
  ) {}

  onModuleInit(): void {
    this.applications.registerCeremonyReader('invitations', async (request) => {
      if (
        request.method !== 'POST' ||
        !BROWSER_APPLICATION_ROUTES.INVITATION_ACCEPT.test(request.path)
      )
        return undefined;
      const body: unknown = request.body;
      if (typeof body !== 'object' || body === null) return undefined;
      const token: unknown = Reflect.get(body, 'token');
      if (
        typeof token !== 'string' ||
        !token ||
        token.length > INVITATION_MAX_TOKEN_LENGTH
      )
        return undefined;
      const invitation = await this.runner.run((work) =>
        this.invitations.takeByTokenHash(work, hashToken(token)),
      );
      const clientId = invitation?.clientId;
      return clientId === ADMIN_CLIENT_ID || clientId === WEB_CLIENT_ID
        ? clientId
        : undefined;
    });
  }
}
